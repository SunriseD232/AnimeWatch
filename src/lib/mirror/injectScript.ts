/**
 * Скрипт, который зеркало (см. §12.6 ARCHITECTURE.md) вставляет ПЕРВЫМ
 * дочерним элементом <head> у зеркалируемой страницы эмбед-плеера — раньше
 * любого её собственного <script>, чтобы патч window.fetch/XHR успел
 * применится до того, как страница сама начнёт делать запросы.
 *
 * Задача скрипта — ровно то, что раньше делал Puppeteer через
 * page.setRequestInterception(true) + request.continue()/response, но внутри
 * НАСТОЯЩЕГО браузера реального посетителя:
 *  1. Заметить .m3u8/.mp4 в любом URL, на который страница делает fetch/XHR
 *     (или ставит video/source.src), и сообщить его родителю через
 *     postMessage — это и есть "перехваченная ссылка", которую раньше ловил
 *     Puppeteer.
 *  2. Любой запрос, чей resolved-хост совпадает с ALLOHA_HOST (т.е. страница
 *     обращается САМА К СЕБЕ, как /bnsi/movies/{id}), перенаправить на путь
 *     нашего зеркала на ТОМ ЖЕ origin — иначе браузер считает это
 *     кросс-доменным запросом (документ отдан нашим доменом, см. <base>
 *     ниже) и блокирует чтение ответа без CORS-заголовков Alloha, которых у
 *     них, скорее всего, нет (эндпоинт не рассчитан на сторонние origin).
 *     <base href> уже гарантирует, что относительные и абсолютные пути в
 *     разметке/JS резолвятся в один и тот же abs-URL независимо от того,
 *     как их написали в исходнике страницы — рерайт видит их одинаково.
 *  3. Синтетический клик в центр viewport'а несколько раз после загрузки —
 *     плееры обычно не начинают резолвить поток сами по себе: автовоспро-
 *     изведение со звуком блокируется браузером без жеста пользователя, а
 *     скрытый iframe этот жест никогда органически не получит. Раньше это
 *     делал Puppeteer (page.mouse.click); здесь то же самое, но диспатчим
 *     событие из СВОЕГО кода, который исполняется в window самой страницы
 *     (см. п.2 — тот же трюк с общим origin/window, что и для fetch/XHR).
 */
export function buildInjectScript(mirrorPrefix: string, allohaHost: string): string {
  // JSON.stringify — безопасное экранирование в JS-строковый литерал.
  return `<script>(function(){
var ALLOHA_HOST=${JSON.stringify(allohaHost)};
var MIRROR_PREFIX=${JSON.stringify(mirrorPrefix)};
var reported=false;
var DECOY=['cdn.plyr.io'];
function report(u){
  if(reported)return;
  if(DECOY.some(function(h){return u.indexOf(h)!==-1;}))return;
  if(/\\.m3u8(\\?|$)/.test(u)||/\\.mp4(\\?|$)/.test(u)){
    reported=true;
    try{window.parent.postMessage({__mediawatchProbe:true,type:'stream-found',url:u},window.location.origin);}catch(e){}
  }
}
function rewrite(raw){
  var abs;
  try{abs=new URL(raw,document.baseURI);}catch(e){return raw;}
  report(abs.href);
  if(abs.hostname===ALLOHA_HOST){
    return MIRROR_PREFIX+abs.pathname+abs.search;
  }
  return raw;
}
var origFetch=window.fetch;
if(origFetch){
  window.fetch=function(input,init){
    if(typeof input==='string'){
      arguments[0]=rewrite(input);
    }else if(input&&typeof input.url==='string'){
      var nu=rewrite(input.url);
      if(nu!==input.url){arguments[0]=new Request(nu,input);}
    }
    return origFetch.apply(this,arguments);
  };
}
var origOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){
  var args=Array.prototype.slice.call(arguments);
  if(typeof url==='string'){args[1]=rewrite(url);}
  return origOpen.apply(this,args);
};
function nudge(){
  try{
    var x=window.innerWidth/2,y=window.innerHeight/2;
    var el=document.elementFromPoint(x,y);
    if(!el)return;
    ['mousedown','mouseup','click'].forEach(function(type){
      el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}));
    });
  }catch(e){}
}
function scheduleNudges(){
  setTimeout(nudge,800);
  setTimeout(nudge,3000);
  setTimeout(nudge,6000);
}
if(document.readyState==='complete'){scheduleNudges();}
else{window.addEventListener('load',scheduleNudges);}
})();</script>`;
}

/**
 * `<script integrity="sha384-...">`/`<link integrity="...">` БЕЗ crossorigin —
 * на реальном домене источника это same-origin ресурсы, SRI работает без
 * вопросов. Но <base href> (см. injectIntoHtml) делает их относительные src/
 * href cross-origin запросами (документ отдаём мы, ресурсы у себя же
 * источника) — а спека требует CORS-режима для проверки integrity
 * cross-origin ресурса; без явного crossorigin браузер такой запрос грузит
 * как no-cors и, видя integrity, ЦЕЛИКОМ блокирует загрузку (opaque-ответ
 * нельзя провалидировать по хешу). Итог, подтверждённый вживую: у Alloha
 * ИМЕННО так блокировались runtime/vendor/app-бандлы — вся логика плеера
 * просто никогда не выполнялась, никаких ошибок в консоли родителя не видно
 * (кросс-origin). Могли бы добавить crossorigin="anonymous" вместо этого, но
 * это завязано бы на то, шлёт ли источник Access-Control-Allow-Origin для
 * статики (не проверено) — просто снять integrity надёжнее и не зависит от
 * их конфигурации CORS.
 */
function stripIntegrity(html: string): string {
  return html.replace(/\s+integrity=(?:"[^"]*"|'[^']*')/gi, '');
}

/** Вставляет скрипт первым потомком <head> (или в начало документа, если <head> не нашёлся). */
export function injectIntoHtml(html: string, scriptTag: string, baseHref: string): string {
  const cleaned = stripIntegrity(html);
  const baseTag = `<base href="${baseHref}">`;
  const headMatch = cleaned.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = headMatch.index! + headMatch[0].length;
    return cleaned.slice(0, idx) + baseTag + scriptTag + cleaned.slice(idx);
  }
  return baseTag + scriptTag + cleaned;
}
