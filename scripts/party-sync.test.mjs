// Тесты арифметики совместного просмотра (src/lib/party/sync.ts).
// Запуск: node --experimental-strip-types --test scripts/party-sync.test.mjs
// .mjs, а не .ts: файл импортирует модуль с расширением .ts (так требует
// Node), а tsc проекта такой импорт не принимает — тест ему проверять незачем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSync, expectedPosition, SEEK_COOLDOWN_MS } from '../src/lib/party/sync.ts';

const T0 = 1_000_000;

function state(over = {}) {
  return { season: 1, episode: 1, translationId: 1, playing: true, time: 100, rate: 1, at: T0, by: 'a', kind: 'play', ...over };
}
function snap(over = {}) {
  return { time: 100, playing: true, rate: 1, duration: 1500, ready: true, ...over };
}
const LONG_AGO = SEEK_COOLDOWN_MS + 1;

test('позиция идущего видео досчитывается по прошедшему времени и скорости', () => {
  assert.equal(expectedPosition(state(), T0 + 10_000), 110);
  assert.equal(expectedPosition(state({ rate: 2 }), T0 + 10_000), 120);
  assert.equal(expectedPosition(state({ playing: false }), T0 + 10_000), 100);
});

test('часы впереди отправителя не дают отрицательного сдвига', () => {
  assert.equal(expectedPosition(state(), T0 - 5_000), 100);
});

test('мелкое расхождение во время игры терпим', () => {
  const d = decideSync(state(), snap({ time: 111 }), T0 + 10_000, LONG_AGO);
  assert.equal(d.seekTo, null);
  assert.equal(d.play, false);
  assert.equal(d.pause, false);
});

test('отставание больше полутора секунд догоняем перемоткой', () => {
  const d = decideSync(state(), snap({ time: 105 }), T0 + 10_000, LONG_AGO);
  assert.equal(d.seekTo, 110);
});

test('вторую перемотку подряд не делаем, пока не прошёл кулдаун', () => {
  const d = decideSync(state(), snap({ time: 105 }), T0 + 10_000, 1_000);
  assert.equal(d.seekTo, null);
});

test('на паузе ставим кадр точнее', () => {
  const d = decideSync(state({ playing: false }), snap({ time: 100.8, playing: false }), T0 + 10_000, LONG_AGO);
  assert.equal(d.seekTo, 100);
});

test('комната играет, а у меня пауза — запускаем', () => {
  const d = decideSync(state(), snap({ time: 110, playing: false }), T0 + 10_000, LONG_AGO);
  assert.equal(d.play, true);
  assert.equal(d.pause, false);
});

test('комната на паузе, а у меня играет — ставим паузу', () => {
  const d = decideSync(state({ playing: false }), snap({ playing: true }), T0 + 10_000, LONG_AGO);
  assert.equal(d.pause, true);
  assert.equal(d.play, false);
});

test('видео грузится или перематывается — ничего не трогаем', () => {
  const d = decideSync(state(), snap({ time: 0, ready: false, playing: false }), T0 + 10_000, LONG_AGO);
  assert.deepEqual(d, { seekTo: null, play: false, pause: false, rate: null });
});

test('комната уже за концом файла — не перематываем в хвост', () => {
  const d = decideSync(state({ time: 1495 }), snap({ time: 1490 }), T0 + 10_000, LONG_AGO);
  assert.equal(d.seekTo, null);
});

test('скорость подтягиваем к комнате', () => {
  const d = decideSync(state({ rate: 1.5 }), snap({ rate: 1 }), T0, LONG_AGO);
  assert.equal(d.rate, 1.5);
  assert.equal(decideSync(state(), snap(), T0, LONG_AGO).rate, null);
});
