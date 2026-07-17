$(document).ready(function () {
    toggleAside();
    initSelect2();
    initCopyCode();
    enterPreviewHeadText();
    watchToColorPickerChange();
    watchToSelectThemeColor();
    resetDarkLightColors();
    initKinopoisk();
    initCopyBtn();
    initSearch();
    initGenViewPass();
    initMoreInfo();
    initClosePopup();
    initChangeProfile();
    scrollToBlock();
    dropHidden();
    showInstruction();
    tooltipMobile();
    initSkipPlayer();
});

function timeToSeconds(timeString) {
    var timeArray = timeString.split(':');
    if (timeArray.length == 3) {
        var hours = parseInt(timeArray[0]);
        var minutes = parseInt(timeArray[1]);
        var seconds = parseInt(timeArray[2]);
        var time = hours * 3600 + minutes * 60 + seconds;
    } else if (timeArray.length == 2) {
        var minutes = parseInt(timeArray[0]);
        var seconds = parseInt(timeArray[1]);
        var time = minutes * 60 + seconds;
    } else {
        var time = parseInt(timeArray[0]);
    }
    return time;
}

function scrollToBlock() {
    $('.js-scroll').on('click', function (event) {
        var target = $(this.getAttribute('href'));
        if (target.length) {
            event.preventDefault();
            $('html, body').animate({
                scrollTop: target.offset().top - 10
            }, 1000);
        }
    });
}

function initSkipPlayer() {
    $('body').on('click', '.js-time-player', function () {
        var $this = $(this);
        var $iframe = $this.attr('data-iframe');
        var $time = $($iframe).attr('data-time');
        var $input = $this.closest('.skip_buttons-popup').find('#skip_buttons');
        var $error = $this.closest('.skip_buttons-popup').attr('data-error-play');
        var $val = $input.val();
        $input.closest('.input-button').find('.field-error').html('');
        if ($time == '0') {
            $input.closest('.input-button').find('.field-error').html($error);
            return false;
        }
        if ($val == '') {
            $input.val($time);
        } else {
            var intervals = $val.split('-').map(interval => interval.trim());
            var interval = $val.split(',').map(interval => interval.trim());
            if ((intervals.length % 2 === 1 && interval.length % 2 === 1) || (intervals.length % 2 === 0 && interval.length % 2 === 0)) {
                $val_new = $val + "-" + $time;
            } else {
                $val_new = $val + ", " + $time;
            }

            $input.val($val_new);
        }
        return false;
    });

    $('body').on('click', '.js-time-delet', function () {
        var $this = $(this);
        var $input = $this.closest('.skip_buttons-popup').find('#skip_buttons');
        var $error = $this.closest('.skip_buttons-popup').attr('data-error-play');
        var $iframe = $this.attr('data-iframe');
        var $time = $($iframe).attr('data-time');
        var $val = $input.val();
        var $val_new = "";
        $input.closest('.input-button').find('.field-error').html('');
        if ($val != ' ' && $val != '') {
            var intervals = $val.split('-').map(interval => interval.trim());
            var interval = $val.split(',').map(interval => interval.trim());
            if (intervals.length % 2 === 1 && interval.length % 2 === 1) {
                interval.pop();
                $val_new = interval.join(", ");
            } else {
                intervals.pop();
                $val_new = intervals.join("-");
            }
        } else if ($time == '0') {
            $input.closest('.input-button').find('.field-error').html($error);
        }
        $input.val($val_new);

        return false;
    });

    $('body').on('click', '.js-skip-test', function () {
        var $this = $(this);
        var $src = $this.attr('data-src');
        var $input = $this.closest('.skip_buttons-popup').find('#skip_buttons');
        var $error1 = $input.attr('data-error-1');
        var $error2 = $input.attr('data-error-2');
        var $error = $this.closest('.skip_buttons-popup').attr('data-error-play');
        var $val = $input.val();
        var intervals = $val.split(',').map(interval => interval.trim());
        var $errors = false;
        var $iframe = $this.attr('data-iframe');
        var $time = $($iframe).attr('data-time');
        if ($time == '0') {
            $input.closest('.input-button').find('.field-error').html($error);
        } else if ($val != ' ' && $val != '') {
            for (var i = 0; i < intervals.length; i++) {
                var currentInterval = intervals[i].split('-');
                if (currentInterval.length === 2) {
                    start = timeToSeconds(currentInterval[0]);
                    end = timeToSeconds(currentInterval[1]);
                    if (end - start < 5) {
                        $errors = true;
                        $input.closest('.input-button').find('.field-error').html($error1);
                        return;
                    }
                }

                var nextInterval_index = i + 1;
                if (nextInterval_index != intervals.length) {
                    var nextInterval = intervals[nextInterval_index].split('-');
                    if (nextInterval.length === 2) {
                        var currentEnd = end;
                        var nextStart = timeToSeconds(nextInterval[0]);
                        if (nextStart - currentEnd < 10) {
                            $errors = true;
                            $input.closest('.input-button').find('.field-error').html($error2);
                            return;
                        }
                    }
                }
            }

            if ($errors == false) {
                $src = $src + "?skip_button=" + $val.replace(/\s/g, "");
                $this.closest('.modal-content').find('iframe').attr('src', $src);


                var $copy_btn = $this.closest('.modal-content').find('.js-copy-text');
                var $copy_iframe = $copy_btn.attr('data-copy');
                var regex = /src="([^"]+)"/;
                var match = $copy_iframe.match(regex);
                var url = match[1];
                var newUrl = url + "?skip_button=" + $val.replace(/\s/g, "");
                var newStr = $copy_iframe.replace(url, newUrl);
                $copy_btn.attr('data-copy', newStr);
            }
        }
    });

    $('body').on('keyup', '#skip_buttons', function () {
        $(this).closest('.input-button').find('.field-error').html('');
    });
}

function initChangeProfile() {
    $('body').on('click', '.js-change_profile', function () {
        var $this = $(this);
        var $successful = $this.attr('data-successful');
        var $form = $this.closest('form');
        var $action = $form.attr('action');
        var $display_name = $form.find('#display_name').val();
        var $custom1 = $form.find('#width').val() + '|' + $form.find('#height').val();
        var $custom2 = $form.find('#custom2').val();
        var $custom3 = $form.find('#custom3').val();
        var data = {};
        data['action'] = 'change_profile';
        data['format'] = 'json';
        data['mode'] = 'async';
        data['display_name'] = $display_name;
        data['custom1'] = $custom1;
        data['custom2'] = $custom2;
        data['custom3'] = $custom3;
        $.ajax({
            url: $action,
            type: 'POST',
            data: data,
            beforeSend: function () {
            },
            complete: function () {
            },
            success: function (data) {
                if (data.status == 'failure') {
                } else {
                    initNotification($successful);
                }
            }
        });

        return false;
    });
}

function initClosePopup() {
    $('body').on('click', '.js-close-popup', function () {
        $(this).closest(".fancybox-skin").find('.fancybox-close').click();
    });
}

function initMoreInfo() {
    $('body').on('click', '.show-more', function () {
        $(this).closest(".column").find('.wrap-box').addClass('show');
        $(this).remove();
    });
}

function initGenViewPass() {
    $('body').on('click', '.js-view-pass', function () {
        var $this = $(this);
        if ($this.hasClass('show')) {
            $('.js-pass').attr('type', 'password');
            $('.js-old_pass').attr('type', 'password');
            $this.removeClass('show');
        } else {
            $('.js-pass').attr('type', 'text');
            $('.js-old_pass').attr('type', 'text');
            $this.addClass('show');
        }
        return false;
    })

    $('body').on('click', '.js-gen-pass', function () {
        var length = 12;
        var charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+";
        var password = "";
        for (var i = 0; i < length; i++) {
            var charIndex = Math.floor(Math.random() * charset.length);
            password += charset.charAt(charIndex);
        }
        $('.js-pass').attr('value', password);
        $('.js-pass').parent().find('.field-error').fadeOut();
    })
}

function initSelect2() {
    const select = $('.js-example-basic-single').select2();
    $('.js-main-filter').select2();
    $("[data-select]").change(function () {
        var $category_ids = ['all'];
        var $data_parameters = '';
        var $link = $('body').find('.js-sort-videos');
        var $release_year;
        $('[data-select]').each(function () {
            if ($(this).val() !== '') {
                if ($(this).attr('name') == 'genres') {
                    $category_ids.push($(this).val());
                } else if ($(this).attr('name') == 'countries') {
                    $category_ids.push($(this).val());
                } else if ($(this).attr('name') == 'release_year') {
                    $release_year = $(this).val();
                }
            }
        });

        $category_ids = $category_ids.join(',');
        if ($category_ids != 'all') {
            $data_parameters += "category_ids:" + $category_ids + ";";
        }
        if ($release_year != undefined) {
            $data_parameters += "release_year_from:" + $release_year + ";release_year_to:" + $release_year + ";";
        }
        $data_parameters += "sort_by:" + $link.attr('data-sort_by') + ";";

        $link.attr('data-parameters', $data_parameters);
        setTimeout(function () {
            $link.click();
        }, 200);
    })
}

function initCopyCode() {
    $('.section-head .radio-ios').each(function () {
        if ($(this).hasClass('true')) {
            $(this).find('.radio-input').click();
        }
    });

    $("body").on('change', '.js-link-checkbox', function () {

        var $this = $(this);
        var $name = $this.attr('name');
        var $parent = $this.closest('.radio-ios');
        if ($parent.hasClass('false')) {
            var $val = 'true';
            $parent.addClass('true').removeClass('false');
        } else {
            var $val = 'false';
            $parent.addClass('false').removeClass('true');
        }
        var date = new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000);
        document.cookie = "kt_rt_" + $name + "=" + $val + "; path=/; expires=" + date.toUTCString();
    })

    $('body').on('click', '.js-copycode', function (event) {
        event.preventDefault();

        var $this = $(this);
        var $text;
        var $textToCopy;
        $('.js-copycode').removeClass('done');
        $this.addClass('done');

        $text = 'Код скопирован!';
        let code_link = $this.attr('data-code');
        let $ins = `<ins ${code_link}></ins>`;
        $textToCopy = $ins;

        copyToClipboard($textToCopy);
        initNotification($text);
    });
}

function initNotification($text) {
    var $block = $('<div class="notification">' + $text + '</div>');
    $(".notification_holder").append($block);
    setTimeout(function () {
        $block.addClass('show');
    }, 200);

    setTimeout(function () {
        $block.removeClass('show');
        setTimeout(function () {
            $block.remove();
        }, 400);
    }, 2000);
}

function copyToClipboard(text) {
    var $temp = $("<textarea>");
    $temp.val(text);
    $temp.css({position: "fixed", left: "-1000px", top: "-1000px"});
    $("body").append($temp);
    $temp.select();
    document.execCommand("copy");
    $temp.remove();
}

function initCopyBtn() {
    $('body').on('click', '.js-copy-text', function () {
        var $this = $(this);
        var $textToCopy = $this.attr('data-copy');
        var $text = $this.attr('data-notification');

        initNotification($text);
        copyToClipboard($textToCopy);
        return false;
    });
}

function initKinopoisk() {
    $('body').on('click', '.js-open-link', function () {
        var $this = $(this);
        var $link = $this.attr('data-link');
        window.open($link);
        return false;
    });

    $('body').on('click', '.js-copy-id', function () {
        var $this = $(this);
        var $textToCopy = $this.attr('data-copy');
        var $text = $this.attr('data-notification');

        initNotification($text);
        copyToClipboard($textToCopy);
        return false;
    });
}

function initSearch() {
    var select = $('.js-search-filter').select2({
        minimumResultsForSearch: -1
    });

    select.change(function () {
        $(this).closest('.section-head').find('.search input').attr('name', $(this).val());
    })
}

$(document).ajaxStop(function () {
    setTimeout(func, 2000);
});

function func() {
    sessionStorage.clear();
}

function toggleAside() {
    const aside = $('.aside');
    if (!aside.length) return;

    const toggleButton = $('.aside-toggle'),
        asideLink = aside.find('.aside-block__list a'),
        bodyTag = $('body');

    function toggleClasses() {
        aside.toggleClass("active");
        toggleButton.toggleClass("active");
        bodyTag.toggleClass('lock');
        $('.main').toggleClass('aside_show');
    }

    function removeClasses() {
        aside.removeClass("active");
        toggleButton.removeClass("active");
        bodyTag.removeClass('lock');

        if ($(window).width() <= 1024) {
            $('.main').removeClass('aside_show');
        }
    }

    toggleButton.on("click", toggleClasses);
    asideLink.on("click", removeClasses);

    $(window).on('resize', function () {
        if ($(window).width() > 1024) {
            $('.main').addClass('aside_show');
            bodyTag.addClass('lock');
        } else {
            $('.main').removeClass('aside_show');
            bodyTag.removeClass('lock');
        }
    });

    $(document).on('click', function (event) {
        if (!aside.hasClass('active')) return;

        if (
            $(event.target).closest('.aside').length > 0 ||
            $(event.target).closest('.aside-toggle').length > 0
        ) {
            return;
        }

        removeClasses();
    });
}


function enterPreviewHeadText() {
    const inputHeadName = $('.input-head-name'),
        inputHeadLink = $('.input-head-link'),
        headLink = $('.preview-head .info-link');

    inputHeadName.on('input', function () {
        headLink.text($(this).val());
    });

    inputHeadLink.on('input', function () {
        headLink.attr('href', $(this).val());
    });
}

function watchToColorPickerChange() {
    const colorPickers = $('.color-picker');
    if (colorPickers.length === 0) return;

    colorPickers.each(function () {
        const input = $(this).find('.input'),
            inputColor = $(this).find('.input-color');

        let colorValue;

        function changeColorValue() {
            if (colorValue.length === 7 && colorValue.charAt(0) === '#') {
                input.attr("value", colorValue);
                input.val(colorValue);
                inputColor.attr("value", colorValue);
                inputColor.val(colorValue);

                changePreviewColor();
            }
        }

        inputColor.on('input', function () {
            colorValue = inputColor.val();
            changeColorValue();
        });

        input.on('input', function () {
            colorValue = input.val();
            changeColorValue();
        });
    });
}

function watchToSelectThemeColor() {
    const select = $('.select.change-theme'),
        previewHead = $('.preview-head'),
        previewBottom = $('.preview-bottom');
    if (!select.length && !previewHead.length && !previewBottom.length) return;

    function changeTheme() {
        if (select.val() === 'dark') {
            previewHead.addClass('dark');
            previewHead.removeClass('light');

            previewBottom.addClass('dark');
            previewBottom.removeClass('light');

        } else if (select.val() === 'light') {
            previewHead.addClass('light');
            previewHead.removeClass('dark');

            previewBottom.addClass('light');
            previewBottom.removeClass('dark');
        }

        changePreviewColor();
    }

    select.on("change", changeTheme);
    changeTheme();
}

function changePreviewColor() {
    const inputDarkBgColor = $('.input.dark-bg'),
        inputDarkBgTextColor = $('.input.dark-bg-text'),
        inputDarkMainBgColor = $('.input.dark-main-bg'),
        inputDarkTextColor = $('.input.dark-main-text'),
        inputLightBgColor = $('.input.light-bg'),
        inputLightBgTextColor = $('.input.light-bg-text'),
        inputLightMainBgColor = $('.input.light-main-bg'),
        inputLightTextColor = $('.input.light-main-text'),
        previewHead = $('.preview-head'),
        headInfoLink = previewHead.find('.info-link'),
        headInfoText = previewHead.find('.info-text'),
        headPlayerInfo = previewHead.find('.player-info'),
        headPlayerInfoTitle = headPlayerInfo.find('.title'),
        headPlayerInfoLinks = headPlayerInfo.find('.links a'),
        previewBottom = $('.preview-bottom'),
        bottomPlayerInfo = previewBottom.find('.player-info'),
        share = previewBottom.find('.share'),
        shareSvgPath = share.find('svg path'),
        views = previewBottom.find('.views'),
        viewsSvgPath = views.find('svg path');

    let darkBg = inputDarkBgColor.val(),
        darkBgText = inputDarkBgTextColor.val(),
        darkMainBgColor = inputDarkMainBgColor.val(),
        darkMainTextColor = inputDarkTextColor.val(),
        lightBg = inputLightBgColor.val(),
        lightBgText = inputLightBgTextColor.val(),
        lightMainBgColor = inputLightMainBgColor.val(),
        lightMainTextColor = inputLightTextColor.val();

    if (previewHead.hasClass('dark')) {
        changeColors(darkBg, darkMainBgColor, darkBgText, darkMainTextColor);
    } else if (previewHead.hasClass('light')) {
        changeColors(lightBg, lightMainBgColor, lightBgText, lightMainTextColor);
    }

    function changeColors(bg, mainBg, text, mainText) {
        previewHead.css('backgroundColor', bg);
        headPlayerInfo.css('backgroundColor', mainBg);
        headInfoLink.css('color', text);
        headInfoText.css('color', text);
        headPlayerInfoTitle.css('color', mainText);
        headPlayerInfoLinks.css('color', mainText);
        previewBottom.css('backgroundColor', bg);
        bottomPlayerInfo.css('backgroundColor', mainBg);
        share.css('color', mainText);
        views.css('color', mainText);
        shareSvgPath.css('fill', mainText);
        viewsSvgPath.css('fill', mainText);
    }
}

function resetDarkLightColors() {
    const inputDarkBgColor = $('.input.dark-bg'),
        inputDarkBgTextColor = $('.input.dark-bg-text'),
        inputDarkMainBgColor = $('.input.dark-main-bg'),
        inputDarkTextColor = $('.input.dark-main-text'),
        inputLightBgColor = $('.input.light-bg'),
        inputLightBgTextColor = $('.input.light-bg-text'),
        inputLightMainBgColor = $('.input.light-main-bg'),
        inputLightTextColor = $('.input.light-main-text'),

        inputColorDarkBgColor = $('.input-color.dark-bg'),
        inputColorDarkBgTextColor = $('.input-color.dark-bg-text'),
        inputColorDarkMainBgColor = $('.input-color.dark-main-bg'),
        inputColorDarkTextColor = $('.input-color.dark-main-text'),
        inputColorLightBgColor = $('.input-color.light-bg'),
        inputColorLightBgTextColor = $('.input-color.light-bg-text'),
        inputColorLightMainBgColor = $('.input-color.light-main-bg'),
        inputColorLightTextColor = $('.input-color.light-main-text');

    const darkBg = inputDarkBgColor.val(),
        darkBgText = inputDarkBgTextColor.val(),
        darkMainBgColor = inputDarkMainBgColor.val(),
        darkMainTextColor = inputDarkTextColor.val(),
        lightBg = inputLightBgColor.val(),
        lightBgText = inputLightBgTextColor.val(),
        lightMainBgColor = inputLightMainBgColor.val(),
        lightMainTextColor = inputLightTextColor.val();

    const resetDarkColor = $('.button.reset-dark'),
        resetLightColor = $('.button.reset-light');

    resetDarkColor.on('click', function () {
        inputDarkBgColor.attr("value", darkBg).val(darkBg);
        inputColorDarkBgColor.attr("value", darkBg).val(darkBg);
        inputDarkBgTextColor.attr("value", darkBgText).val(darkBgText);
        inputColorDarkBgTextColor.attr("value", darkBgText).val(darkBgText);
        inputDarkMainBgColor.attr("value", darkMainBgColor).val(darkMainBgColor);
        inputColorDarkMainBgColor.attr("value", darkMainBgColor).val(darkMainBgColor);
        inputDarkTextColor.attr("value", darkMainTextColor).val(darkMainTextColor);
        inputColorDarkTextColor.attr("value", darkMainTextColor).val(darkMainTextColor);

        changePreviewColor();
    });

    resetLightColor.on('click', function () {
        inputLightBgColor.attr("value", lightBg).val(lightBg);
        inputColorLightBgColor.attr("value", lightBg).val(lightBg);
        inputLightBgTextColor.attr("value", lightBgText).val(lightBgText);
        inputColorLightBgTextColor.attr("value", lightBgText).val(lightBgText);
        inputLightMainBgColor.attr("value", lightMainBgColor).val(lightMainBgColor);
        inputColorLightMainBgColor.attr("value", lightMainBgColor).val(lightMainBgColor);
        inputLightTextColor.attr("value", lightMainTextColor).val(lightMainTextColor);
        inputColorLightTextColor.attr("value", lightMainTextColor).val(lightMainTextColor);

        changePreviewColor();
    });
}

function dropHidden() {
    $("body").on("click", '.btn-drop', function () {
        var $this = $(this).parent();

        if ($this.hasClass('show')) {
            $this.removeClass('show');
        } else {
            $this.addClass('show');
        }
    });
    $(".wrapper").on("click", function (event) {
        if (!$(event.target).closest(".btn-drop, .drop-hidden").length) {
            if ($(".dropped").hasClass("show")) {
                $(".dropped").removeClass("show");
            }
        }
    });
}

function showInstruction() {
    $("body").on("click", '.show-instruction', function () {
        var instructionBox = $('.instruction-box');
        var button = $(this);
        var parent = instructionBox.parent();

        if (parent.attr('data-attr-instruction') === 'true') {
            parent.attr('data-attr-instruction', 'false');
            button.removeClass('active');
        } else {
            parent.attr('data-attr-instruction', 'true');
            button.addClass('active');
        }
    });
}

function tooltipMobile() {
    $("body").on("click", '[data-tooltip]', function () {
        var $this = $(this);

        if ($this.hasClass('show')) {
            $this.removeClass('show');
        } else {
            $this.addClass('show');
        }
    });
    $(".wrapper").on("click", function (event) {
        if (!$(event.target).closest("[data-tooltip]").length) {
            if ($("[data-tooltip]").hasClass("show")) {
                $("[data-tooltip]").removeClass("show");
            }
        }
    });
}