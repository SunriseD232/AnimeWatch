var link = "";

function sendReferralToken(reftoken) {
    if (localStorage.getItem('referral_sent_' + reftoken) === 'true') {
        return;
    }

    $.ajax({
        type: "POST",
        crossDomain: true,
        url: link + '/api/v1/auth/referral',
        data: JSON.stringify({"referral_token": reftoken}),
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (data) {
            localStorage.setItem('referral_sent_' + reftoken, 'true');
        },
        error: function (errMsg) {
        }
    });
}

function initSelect2(selector) {
    $(selector).each(function () {
        var placeholder = '';
        var multiple = false;
        var width = 'resolve';
        var ctx = $(this);

        if ($(this).attr('multiple') == 'multiple') {
            multiple = true;
            $(this).closest('div').addClass('select2-block-multi')
        } else
            $(this).closest('div').addClass('select2-block-singl')

        if ($(this).data('placeholder'))
            placeholder = $(this).data('placeholder');

        if ($(this).data('select2-width'))
            width = $(this).data('select2-width');

        if ($(this).data('ajax-url')) {
            let url = $(this).data('ajax-url');
            let minlength = 3;

            if ($(this).data('minlength') !== undefined)
                minlength = $(this).data('minlength');

            if ($(this).data('value'))
                $.ajax({
                    dataType: 'JSON',
                    url: url + "&q=" + $(this).data('value'),
                }).done(function (res) {
                    if (res['items'] && res['items'].length > 1) {
                        $.each(res['items'], function (i, item) {
                            $(ctx).append('<option value="' + item['id'] + '">' + item['text'] + '</option>')
                        });
                        $(ctx).val($(ctx).data('value')).change();
                    }
                }).fail(function (d) {
                })
            $(this).select2({
                minimumInputLength: minlength,
                width: width,
                placeholder: placeholder,
                debug: true,
                closeOnSelect: !multiple,
                dropdownParent: $(this).closest('div'),
                templateSelection: function (selection) {
                    return $.parseHTML('<span class="' + $(selection.element).attr('class') + '">' + selection.text + '</span>');
                },
                ajax: {
                    data: function (params) {
                        params['params'] = $(this).data('ajax-url');
                        var ctx = this;
                        $.each($(this).data(), function (field) {
                            if (field.toString().indexOf('param_') === 0)
                                params[field.toString()] = $(ctx).data(field.toString())
                        })
                        return params;
                    },
                    url: url,
                    dataType: 'json',
                    processResults: function (data) {
                        return {results: data.items};
                    }
                },
                templateResult: function (data, container) {
                    if (data['class']) $(container).addClass(data['class']);
                    if (data['data-act']) $(container).data('act', data['data-act']);
                    if (data['data-name']) $(container).data('name', data['data-name']);
                    return data.text;
                }
            });
        } else {
            $(this).select2({
                language: "ru",
                width: width,
                placeholder: placeholder,
                debug: true,
                closeOnSelect: !multiple,
                dropdownParent: $(this).closest('div'),
                templateResult: function (data, container) {
                    if (data.element) $(container).addClass($(data.element).attr("class"));
                    return data.text;
                }
            });
        }
    });
}

function locationHashChanged() {
    initMaintenanceBlock();
    loadTrialStatus();

    if (localStorage.getItem('token')) {
        updateRknBadge();
    }

    const studioStatistics = $('#studio_statistics');
    studioStatistics.parent().hide();
    if ($(window).width() > 1024) {
        $('.main').addClass('aside_show');
    }

    const urlParams = new URLSearchParams(window.location.search);
    const reftoken = urlParams.get('ref');
    if (reftoken) {
        PAGES.login();
        applyTranslationsToPage();
        return;
    }

    if (localStorage.getItem('role') === "studio") {
        studioStatistics.parent().show();
    }

    if (location.hash === "#rkn/") {
        PAGES.rkn();
        applyTranslationsToPage();
        return;
    }

    if (location.hash === "#logout/") {
        PAGES.logout();
        applyTranslationsToPage();
        return;
    }
    if (location.hash === "#register_vibix/") {
        PAGES.register();
        applyTranslationsToPage();
        return;
    }
    if (location.hash === "#login/" || location.hash === "#login/after_forgot" || location.hash === "#login/after_registration" || location.hash === "#login/after_changed" || location.hash === "#login/email_verified") {
        PAGES.login();
        applyTranslationsToPage();
        return;
    }
    if (location.hash === "#forgot-password/") {
        PAGES.forgot_password();
        applyTranslationsToPage();
        return;
    }
    if (location.hash.toString().indexOf("#reset-password/") === 0) {
        PAGES.reset_password();
        applyTranslationsToPage();
        return;
    }
    if (location.hash === "#resend-confirmation/") {
        PAGES.resend_confirmation();
        applyTranslationsToPage();
        return;
    }

    if (!localStorage.getItem('token')) {
        window.location.href = '/#login/';
        return;
    }

    if (location.hash === "#/" || location.hash === "") {
        PAGES.catalog();
        applyTranslationsToPage();
        return;
    }

    if (location.hash === "#referral/") {
        PAGES.referral();
        applyTranslationsToPage();
        return;
    }

    if (location.hash === "#statistics/") {
        PAGES.statistics();
        applyTranslationsToPage();

        $(document).ready(function () {
            $gridFilter = $('#grid_filter');
            $gridFilter.on('change', 'input[name="filter.date_from"]', function () {
                const $startDateInput = $(this);
                const $endDateInput = $(this).closest('div').next().find('input[name="filter.date_to"]');
                const startDate = moment($startDateInput.val());
                const endDate = moment($endDateInput.val());

                if (startDate.isValid() && endDate.isValid()) {
                    const diffMonths = endDate.diff(startDate, 'months', true);
                    if (diffMonths > 3) {
                        const newEndDate = startDate.clone().add(3, 'months');
                        $endDateInput.val(newEndDate.format('YYYY-MM-DD'));
                    }
                }
                if (window.statisticsTable) {
                    window.statisticsTable.reload();
                }
            })
            $gridFilter.on('change', 'input[name="filter.date_to"]', function () {
                const $endDateInput = $(this);
                const $startDateInput = $(this).closest('div').prev().find('input[name="filter.date_from"]');
                const startDate = moment($startDateInput.val());
                const endDate = moment($endDateInput.val());

                if (startDate.isValid() && endDate.isValid()) {
                    const diffMonths = endDate.diff(startDate, 'months', true);
                    if (diffMonths > 3) {
                        const newStartDate = endDate.clone().subtract(3, 'months');
                        $startDateInput.val(newStartDate.format('YYYY-MM-DD'));
                    }
                }
                if (window.statisticsTable) {
                    window.statisticsTable.reload();
                }
            });
        });
        return;
    }

    if (location.hash === "#studio_statistics/") {
        PAGES.studio_statistics();
        setTimeout(function () {
            applyTranslationsToPage();
        }, 100);

        $(document).ready(function () {
            $gridFilter = $('#grid_filter');
            $gridFilter.on('change', 'input[name="filter.date_from"]', function () {
                const $startDateInput = $(this);
                const $endDateInput = $(this).closest('div').next().find('input[name="filter.date_to"]');
                const startDate = moment($startDateInput.val());
                const endDate = moment($endDateInput.val());

                if (startDate.isValid() && endDate.isValid()) {
                    const diffMonths = endDate.diff(startDate, 'months', true);
                    if (diffMonths > 3) {
                        const newEndDate = startDate.clone().add(3, 'months');
                        $endDateInput.val(newEndDate.format('YYYY-MM-DD'));
                    }
                }
                if (window.studioStatisticsTable) {
                    window.studioStatisticsTable.reload();
                }
            })
            $gridFilter.on('change', 'input[name="filter.date_to"]', function () {
                const $endDateInput = $(this);
                const $startDateInput = $(this).closest('div').prev().find('input[name="filter.date_from"]');
                const startDate = moment($startDateInput.val());
                const endDate = moment($endDateInput.val());

                if (startDate.isValid() && endDate.isValid()) {
                    const diffMonths = endDate.diff(startDate, 'months', true);
                    if (diffMonths > 3) {
                        const newStartDate = endDate.clone().subtract(3, 'months');
                        $startDateInput.val(newStartDate.format('YYYY-MM-DD'));
                    }
                }
                if (window.studioStatisticsTable) {
                    window.studioStatisticsTable.reload();
                }
            });
        });
        return;
    }

    if (location.hash === "#instructions/") {
        PAGES.instructions();
        applyTranslationsToPage();
        return;
    }
    if (location.hash === "#profile/") {
        PAGES.profile();
        applyTranslationsToPage();
        return;
    }
    if (location.hash === "#finance/") {
        PAGES.finance();
        applyTranslationsToPage();
        return;
    }
}

var FORM = {
    api: link + '/',
    form_selector: '',
    submit_selector: '',
    save_method: '',
    get_method: '',
    callback_after_save: function (data) {
    },
    init: function (api_url, form_selector, get_method, save_method = false, submit_selector = false, callback_after_save = false) {
        if (form_selector && api_url) {
            this.api = api_url;
            this.form_selector = form_selector;
            this.submit_selector = submit_selector;
            this.get_method = get_method;
            this.save_method = save_method;
            this.callback_after_save = callback_after_save;

            if (this.get_method)
                this.getFields();

            if (submit_selector)
                $(`${FORM.form_selector} ${submit_selector}`).click(function () {
                    FORM.req(FORM.save_method, FORM.getForm(), function (data, isOk = true) {
                        FORM.callback_after_save(data, isOk);
                    });
                });

        }
    },
    getFields: function () {
        this.req(FORM.get_method, false, function (res) {
            if (res['data']) {
                $.each(res['data'], function (field, value) {
                    $(`${FORM.form_selector} [name="${field}"]`).val(value);
                    if (parseInt(value)) {
                        $(`${FORM.form_selector} [name="${field}"]:checkbox`).prop('checked', true);
                    }
                });
            }
        });
    },
    getForm: function () {
        var data = {};
        $(`${FORM.form_selector} [name]`).each(function () {
            if ($(this).attr('name'))
                data[$(this).attr('name')] = $(this).val();
        });
        $(`${FORM.form_selector} input:checkbox`).each(function () {
            if ($(this).is(':checked')) {
                data[$(this).attr('name')] = 1;
            } else {
                data[$(this).attr('name')] = 0;
            }
        });
        return data;
    },
    req: function (method, data, callback = null) {
        $.ajax({
            beforeSend: function (xhr, settings) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
            },
            type: data === false ? "GET" : "POST",
            crossDomain: true,
            url: FORM.api + method,
            data: data === false ? null : JSON.stringify(data),
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function (data) {
                if (callback !== null)
                    callback(data)
            },
            error: function (errMsg) {
                if (errMsg['responseJSON'] && errMsg['responseJSON']['message'])
                    callback(errMsg['responseJSON'], false);
                else
                    callback({"message": "Что то пошло не так ;("}, false);
            }
        });
    },
};

class DataTableManager {

    static activeTable = null;

    constructor(config) {

        this.api = config.api;
        this.tableSelector = config.tableSelector;
        this.filterSelector = config.filterSelector;
        this.tableSearch = config.tableSearch !== undefined ? config.tableSearch : true;

        this.columns = config.columns || null;
        this.lengthMenu = config.lengthMenu || [[20, 100], [20, 100]];
        this.searchDelay = config.searchDelay || 0;
        this.searchPlaceholder = config.searchPlaceholder || "Поиск...";
        this.order = config.order || [[1, 'desc']];

        this.customRenderers = config.customRenderers || {};

        this.table = null;
        this.filterContainer = null;

        this.init = this.init.bind(this);
        this.initFilters = this.initFilters.bind(this);
        this.getFilter = this.getFilter.bind(this);
        this.createFilterItem = this.createFilterItem.bind(this);
        this.setFilterList = this.setFilterList.bind(this);
        this.initTable = this.initTable.bind(this);
        this.req = this.req.bind(this);
        this.reqForCSV = this.reqForCSV.bind(this);

        if (this.tableSelector && this.filterSelector) {
            this.init();
        }

        DataTableManager.activeTable = this;
    }

    static exportCurrentTable() {
        if (DataTableManager.activeTable) {
            DataTableManager.activeTable.reqForCSV();
        } else {
            console.warn('Нет активной таблицы для экспорта');
        }
    }

    static reloadCurrentTable() {
        if (DataTableManager.activeTable && DataTableManager.activeTable.reload) {
            DataTableManager.activeTable.reload();
        }
    }

    init() {
        if (!this.tableSelector || !this.api || !this.filterSelector) {
            console.error('DataTableManager err');
            return;
        }
        this.initFilters(this.initTable.bind(this));
    }

    updateLanguage() {
        if (this.table) {
            this.table.settings()[0].oLanguage = this.getDataTableLanguage();
            this.table.draw();
        }
    }

    initFilters(onInit) {
        this.req('getFilters', {}, this.setFilterList.bind(this, onInit));
    }

    getFilter(filterClass = '') {
        const form = {'filter': {}, 'group': {}};
        $(`${this.filterSelector} .form-control ${filterClass}`).each(function () {
            if ($(this).val()) {
                const partsName = $(this).attr('name').split('.');
                if (partsName.length === 2) {
                    form[partsName[0]][partsName[1]] = $(this).val();
                } else if (partsName.length === 3) {
                    if (!form[partsName[0]][partsName[1]]) {
                        form[partsName[0]][partsName[1]] = {};
                    }
                    form[partsName[0]][partsName[1]][partsName[2]] = $(this).val();
                }
            }
        });
        return form;
    }

    createFilterItem(container, type, field, filter) {
        const currentLang = localStorage.getItem('app_lang') || 'ru';
        const dataSets = filter['ajax-url'] ? ` data-ajax-url="${filter['ajax-url']}"` : '';
        const fieldName = `${type}.${field}`;

        const desText = filter.des && filter.des[currentLang] ? filter.des[currentLang] : filter.des;

        if (filter['date']) {
            const inputId = 'custom-date-' + fieldName.replace(/\./g, '_');

            container.append(`
            <div class="col-md-${filter['size']} col-lg-${filter['size'] - 1}" style="float: left; margin-bottom: 5px;">
                <input value="${filter['date']}" type="text" id="${inputId}" placeholder="${desText}"  
                       name="${fieldName}" class="form-control form-control-sm float-left" style="min-width: 100px" title="">
            </div>
        `);

            const inputElem = document.getElementById(inputId);

            flatpickr(inputElem, {
                dateFormat: "Y-m-d",
                locale: "ru",
                clickOpens: true,
                disableMobile: true,
                onOpen: function () {
                    if (!document.querySelector('.flatpickr-overlay')) {
                        const overlay = document.createElement('div');
                        overlay.className = 'flatpickr-overlay';
                        overlay.addEventListener('click', () => {
                            if (window.calendarInstance) window.calendarInstance.close();
                        });
                        document.body.appendChild(overlay);
                    }
                },
                onClose: function () {
                    const overlay = document.querySelector('.flatpickr-overlay');
                    if (overlay) overlay.remove();
                },
                onReady: function (selectedDates, dateStr, instance) {
                    window.calendarInstance = instance;
                }
            });
        } else {
            const multiple = filter['multiple'] ? 'multiple' : '';
            container.append(`
            <div class="col-md-${filter['size']} col-lg-${filter['size'] - 1}" style="float: left; margin-bottom: 5px">
                <select ${dataSets} name="${fieldName}" ${multiple} data-placeholder="${desText}" 
                        data-minlength="0" class="use_select2 form-control form-control-sm float-left" style="width: 100%">
                    <option value="">${desText} - Все</option>
                </select>
            </div>
        `);

            if (filter['list']) {
                $.each(filter['list'], (i, item) => {
                    let itemName = '';
                    if (item.name && typeof item.name === 'object') {
                        itemName = item.name[currentLang] !== null && item.name[currentLang] !== undefined
                            ? item.name[currentLang]
                            : (item.name['ru'] || item.name['en'] || item.value);
                    } else {
                        itemName = item.name || item.value;
                    }

                    const count = item['count'] ? ` (${item['count']})` : '';
                    $(`[name="${fieldName}"]`, container).append(`<option value="${item['value']}">${itemName}${count}</option>`);
                });
            }

            const savedValue = localStorage.getItem("_" + fieldName);
            if (savedValue) {
                if ($(`[name="${fieldName}"]`, container).prop('multiple')) {
                    $.each(savedValue.split(","), (i, e) => {
                        $(`[name="${fieldName}"] option[value="${e}"]`, container).prop("selected", true);
                    });
                } else {
                    $(`[name="${fieldName}"]`, container).val(savedValue);
                }
            } else if (filter['default']) {
                $.each(filter['default'].split(","), (i, e) => {
                    $(`[name="${fieldName}"] option[value="${e}"]`, container).prop("selected", true);
                });
            }

            initSelect2(`[name="${fieldName}"]`);
        }

        $(`[name="${fieldName}"]`, container).change(() => {
            localStorage.setItem("_" + fieldName, $(`[name="${fieldName}"]`).val());
            if (this.table) {
                this.table.ajax.url(this.api + "data").draw();
            }
        });
    }

    setFilterList(onInit, data) {
        const $container = $(this.filterSelector);

        $container.empty();

        $.each(data['group'] || {}, (field, filter) => {
            this.createFilterItem($container, 'group', field, filter);
        });

        $.each(data['filters'] || {}, (field, filter) => {
            this.createFilterItem($container, 'filter', field, filter);
        });

        onInit();
    }

    req(method, data, callback = null) {
        data.lang = 'all';
        $.ajax({
            beforeSend: (xhr) => {
                xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
            },
            type: "POST",
            crossDomain: true,
            url: this.api + method,
            data: JSON.stringify(data),
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: (data) => {
                if (callback) callback(data);
            },
            error: (errMsg) => {
                console.error('API Error:', errMsg);
                window.location.href = '/#logout/';
            }
        });
    }

    initTable() {
        const self = this;

        const processColumns = (columns) => {
            let finalColumns = columns;

            finalColumns.unshift({
                className: 'dtr-control',
                orderable: false,
                data: null,
                defaultContent: '<div class="dtr-btn"></div>',
                responsivePriority: 1,
                targets: 0,
            });


            const dtColumns = finalColumns.map(column => ({
                data: column.data,
                title: column.title,
                orderable: column.sorting !== undefined ? column.sorting : true,
                className: column.className,
                defaultContent: column.defaultContent,
                responsivePriority: column.responsivePriority,
                render: this.customRenderers[column.data] || column.render || null
            }));

            if (this.table !== null) {
                this.table.destroy();
                $(this.tableSelector).empty();
            }

            this.table = $(this.tableSelector).DataTable({
                responsive: {
                    details: {
                        type: 'column',
                        target: 0,
                        renderer: function (api, rowIdx, columns) {
                            const hiddenCols = columns.filter(col => col.hidden);
                            if (!hiddenCols.length) return false;

                            let html = `<div class="card border-0 mb-0 p-0">
                            <div class="card-body p-0">
                                <div class="row g-2">`;

                            hiddenCols.forEach(col => {
                                html += `<div class="col-12">
                                <div class="d-flex border rounded px-3 py-2 align-items-center">
                                    <div class="fw-semibold me-2 text-nowrap" style="min-width: 30%;">
                                        ${col.title}
                                    </div>
                                    <div class="flex-grow-1 text-break" style="text-align: right;">
                                        ${col.data || '<span class="text-muted">—</span>'}
                                    </div>
                                </div>
                            </div>`;
                            });

                            html += `</div></div></div>`;
                            return $(html)[0];
                        }
                    }
                },
                bInfo: false,
                ajax: {
                    beforeSend: (xhr) => {
                        xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                    },
                    type: 'POST',
                    url: this.api + "data",
                    data: (data) => {
                        const form = this.getFilter();
                        data.filter = form.filter;
                        data.group = form.group;
                        data.lang = "all";

                        return data;
                    }
                },
                paging: true,
                searching: this.tableSearch,
                ordering: true,
                autoWidth: false,
                order: this.order,
                select: true,
                layout: {
                    topStart: 'info',
                    bottom: 'paging',
                    bottomStart: null,
                    bottomEnd: null
                },
                lengthMenu: this.lengthMenu,
                processing: true,
                serverSide: true,
                columns: dtColumns,
                language: this.getDataTableLanguage(),
                searchDelay: this.searchDelay,
                search: {
                    placeholder: this.searchPlaceholder
                }
            });

            // attach page-jump popup to pagination ellipsis
            this.initPageJumpPopup();
        };

        if (this.columns) {
            processColumns(this.columns);
        } else {
            this.req('columnsTable', {}, processColumns);
        }
    }

    getDataTableLanguage() {
        return {
            "processing": __("table.processing"),
            "search": "",
            "info": __("table.info"),
            "infoEmpty": __("table.infoEmpty"),
            "infoFiltered": __("table.infoFiltered"),
            "loadingRecords": __("table.loadingRecords"),
            "zeroRecords": __("table.zeroRecords"),
            "emptyTable": __("table.emptyTable"),
            "lengthMenu": __("table.lengthMenu"),
            "paginate": {
                "first": __("table.paginate.first"),
                "previous": __("table.paginate.previous"),
                "next": __("table.paginate.next"),
                "last": __("table.paginate.last")
            },
            "searchPlaceholder": this.searchPlaceholder
        };
    }

    reqForCSV() {
        const filters = this.getFilter();
        filters.draw = 0;
        filters.length = 1500;

        const getColumns = (callback) => {
            if (this.columns) {
                callback(this.columns);
            } else {
                this.req('columnsTable', {}, callback);
            }
        };

        getColumns((columns) => {
            const columnMap = {};
            columns.forEach(column => {
                columnMap[column.data] = column.title;
            });

            $.ajax({
                beforeSend: (xhr) => {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                },
                type: "POST",
                crossDomain: true,
                url: this.api + 'data',
                data: JSON.stringify(filters),
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: (response) => {
                    if (response.data && response.recordsTotal > 0) {
                        let csvContent = "";
                        const columnOrder = Object.keys(columnMap);

                        const headers = columnOrder.map(key => {
                            const header = columnMap[key];
                            return header.includes(',') ? `"${header}"` : header;
                        });
                        csvContent += headers.join(",") + "\r\n";

                        response.data.forEach(row => {
                            const values = columnOrder.map(key => {
                                let value = row[key] || "";
                                if (typeof value === 'string' && value.includes(',')) {
                                    return `"${value}"`;
                                }
                                return value;
                            });
                            csvContent += values.join(",") + "\r\n";
                        });

                        const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8'});
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.setAttribute("href", url);
                        link.setAttribute("download", "Vibix.csv");
                        document.body.appendChild(link);
                        link.click();
                        setTimeout(() => {
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                        }, 100);
                    }
                },
                error: (err) => {
                    console.error('CSV Export Error:', err);
                }
            });
        });
    }

    reload() {
        if (this.table) {
            this.table.ajax.reload();
        }
    }

    initPageJumpPopup() {
        const self = this;
        const $popup = $("#pageJumpPopup");
        const $overlay = $("#pageJumpOverlay");
        const $input = $("#pageJumpInput");
        const $total = $("#pageJumpTotal");
        const $container = $(this.tableSelector).closest(".dataTables_wrapper");

        let currentTarget = null;

        function showPopup($btn) {
            const pageInfo = self.table.page.info();
            if (pageInfo.pages <= 1) return;

            currentTarget = $btn;
            $total.text(pageInfo.pages);
            $input.val("").attr("max", pageInfo.pages);

            // briefly show popup off-screen to measure dimensions
            $popup.css({ top: -9999, left: -9999 }).addClass("show");
            const rect = $btn[0].getBoundingClientRect();
            const popupWidth = $popup.outerWidth();

            $popup.css({
                top: Math.max(0, rect.top - $popup.outerHeight() - 12),
                left: Math.max(10, Math.min(
                    $(window).width() - popupWidth - 10,
                    rect.left + rect.width / 2 - popupWidth / 2
                ))
            });

            $overlay.addClass("show");
            setTimeout(() => $input.focus(), 100);
        }

        function hidePopup() {
            currentTarget = null;
            $overlay.removeClass("show");
            $popup.removeClass("show");
        }

        function doJump() {
            const pageInfo = self.table.page.info();
            let pageNum = parseInt($input.val(), 10);

            if (isNaN(pageNum) || pageNum < 1) return;
            if (pageNum > pageInfo.pages) pageNum = pageInfo.pages;

            self.table.page(pageNum - 1).draw("page");
            hidePopup();
        }

        $overlay.off("click.pageJump").on("click.pageJump", hidePopup);
        $popup.off("click.pageJump").on("click.pageJump", function (e) { e.stopPropagation(); });

        $input.off("keydown.pageJump").on("keydown.pageJump", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                doJump();
            }
            if (e.key === "Escape") {
                e.preventDefault();
                hidePopup();
                $input.blur();
            }
        });

        $("#pageJumpBtn").on("click", doJump);

        // bind direct handler to ellipsis pagination buttons after each draw
        // Bootstrap 5 DataTables renders ellipsis as text inside <a data-dt-idx="ellipsis">
        // We must unbind DataTables' own handler (click.DT namespace) to prevent navigation
        self.table.off("draw.pageJump").on("draw.pageJump", function () {
            hidePopup();
            bindEllipsis();
        });

        // initial bind (draw already fired before this method was called)
        bindEllipsis();

        function bindEllipsis() {
            setTimeout(function () {
                $container.find('a[data-dt-idx="ellipsis"]')
                    .off("click.DT")
                    .off("click.pageJump")
                    .on("click.pageJump", function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        showPopup($(this).closest(".paginate_button"));
                    });
            }, 0);
        }
    }
}


var PAGES = {
    register: function () {
        $('.main').removeClass('aside_show');
        $('#content').html(`
<div class="settings-content user_form">
  <h4 class="title" data-i18n="login_page.registration_title"></h4>
  <div id="register_form">
   <div class="generic-error alert alert-primary d-none"></div>
   <div class="form-group">
    <label for="signup_username" class="field-label required" data-i18n="login_page.username_label"></label>
    <div class="input-button">
     <input type="text" name="name" id="signup_username" class="textfield input" maxlength="100" data-i18n-placeholder="login_page.username_placeholder" placeholder="">
     <div class="field-error down" style="display: none;"></div>
    </div>
   </div>

   <div class="form-group">
    <label for="signup_pass" class="field-label required" data-i18n="login_page.password_label">Пароль</label>
    <div class="input-button custom-mobile">
     <input type="password" name="password" id="signup_pass" class="textfield input js-pass" data-i18n-placeholder="login_page.password_min_hint" placeholder="">
     <div class="field-error down" style="display: none;"></div>
     <div class="button only-icon js-view-pass">
      <svg class="icon">
       <use xlink:href="#icon-eye"></use>
      </svg>
     </div>
     <div class="button regular js-gen-pass" data-i18n="buttons.generate"></div>
    </div>
   </div>

   <div class="form-group">
    <label for="signup_pass2" class="field-label required" data-i18n="login_page.password_confirm_label">Подтверждение пароля</label>
    <div class="input-button">
     <input type="password" name="password_confirmation" id="signup_pass2" class="textfield input js-pass" data-i18n-placeholder="login_page.password_confirm_placeholder" placeholder="повторите ввод пароля">
     <div class="field-error down"></div>
    </div>
   </div>

   <div class="form-group">
    <label for="signup_email" class="field-label required" data-i18n="login_page.email_label">Email</label>
    <div class="input-button">
     <input type="text" name="email" id="signup_email" class="textfield input" maxlength="100" data-i18n-placeholder="login_page.email_reg_placeholder" placeholder="будет использоваться для восстановления доступа">
     <div class="field-error down"></div>
    </div>
   </div>

    <div class="form-group d-none">
     <label data-i18n="login_page.captcha_label">Пожалуйста, подтвердите, что вы не являетесь автоматической программой.</label>
     <div class="captcha-control">
             <div class="image">
        <img src="https://www.vibix.org/captcha/signup/?rand=1718235411" alt="Картинка защиты">
        <br>
        <div class="input-button">
         <input type="text" name="code" id="login_code" class="textfield input" autocomplete="off">
         <div class="field-error up"></div>
        </div>
       </div>
           </div>
    </div>
    
   <button class="button submit" data-i18n="login_page.register_button">Зарегистрироваться</button>
   <div class="bottom form_links">
    <div class="links">
     <p><a href="#login/" data-i18n="login_page.have_account">У меня есть аккаунт.</a></p>
    </div>
   </div>
  </div>
 </div>
`);
        FORM.init(link + '/api/v1/', '#register_form', '', 'register', '.submit', function (data, isOk) {
            if (isOk) {
                window.location.href = '/#login/after_registration';
            } else {
                $('.generic-error').removeClass('d-none')
                $('.generic-error').text(data.message)
            }
        });
    },

    login: function () {
        const urlParams = new URLSearchParams(window.location.search);
        const reftoken = urlParams.get('ref');
        $('#top-header').hide();
        $('.main').removeClass('aside_show');
        $('.aside-toggle').addClass('hidden');
        if (reftoken) {
            sendReferralToken(reftoken);
            $('#content').html(`
            <div class="settings-content user_form">
             <h4 class="title" data-i18n="login_page.registration_title">Регистрация</h4>
             <div id="application-form">
              <div class="generic-error alert alert-primary d-none"></div>
              <div class="form-group">
               <label for="login_username" class="field-label required" data-i18n="login_page.email_label">Ваш Email</label>
               <div class="input-button">
                <input type="text" name="email" class="textfield input" data-i18n-placeholder="login_page.email_placeholder" placeholder="введите email">
                <div class="field-error down" style="display: none;"></div>
               </div>
              </div>
              <div class="form-group">
               <label class="field-label required" data-i18n="login_page.telegram_label">Ваш телеграм</label>
               <div class="input-button">
                <input type="text" name="telegram" class="textfield input" data-i18n-placeholder="login_page.telegram_placeholder" placeholder="введите Ваш телеграм">
                <div class="field-error down" style="display: none;"></div>
               </div>
              </div>
              <div class="form-group" style="display: none;">
               <label class="field-label required"></label>
               <div class="input-button">
                <input name="referral_token" type="hidden" value=${reftoken}>
                <div class="field-error down" style="display: none;"></div>
               </div>
              </div>
              <button class="button submit referral_submit" data-i18n="login_page.register_and_start">Зарегистрироваться и начать</button>
              
              </div>
             </div>
            </div>
            `);
            FORM.init(link + '/api/v1/', '#application-form', '', 'auth/referral/create', '.referral_submit', function (data, isOk) {
                if (isOk) {
                    $('.generic-error').removeClass('d-none')
                    $('.generic-error').text(__('login_page.manager_contact'))

                    $('.submit')
                        .text(__('login_page.go_to_main'))
                        .off('click')
                        .on('click', function () {
                            window.location.href = '/#login';
                        });
                } else {
                    $('.generic-error').removeClass('d-none')
                    $('.generic-error').text(data.message)
                }
            });

        } else {
            $('#content').html(`
            <div class="settings-content user_form">
             <h4 class="title" data-i18n="login_page.title">Вход</h4>
             <div id="login_form">
              <div class="generic-error alert alert-primary d-none"></div>
              <div class="form-group">
               <label for="login_username" class="field-label required" data-i18n="login_page.email_label">Ваш Email</label>
               <div class="input-button">
                <input type="text" name="email" class="textfield input" data-i18n-placeholder="login_page.email_placeholder" placeholder="введите email">
                <div class="field-error down" style="display: none;"></div>
               </div>
              </div>
              <div class="form-group">
               <label for="login_pass" class="field-label required" data-i18n="login_page.password_label">Пароль</label>
               <div class="input-button">
                <input type="password" name="password" class="textfield input" data-i18n-placeholder="login_page.password_placeholder" placeholder="введите пароль">
                <div class="field-error down" style="display: none;"></div>
               </div>
              </div>
                 <div class="radio-ios form-group">
                <input type="checkbox" name="remember_me" id="login_remember_me" class="checkbox radio-input" value="1">
                <label for="login_remember_me" data-i18n="login_page.remember_me">запомнить меня</label>
               </div> 
              <button class="button submit login_submit" data-i18n="login_page.login_button">Войти</button>
              <br>
              <a 
                    href="https://t.me/vibix_tv" 
                    target="_blank"
                    class="button"
                    style="
                        display: inline-block;
                        background: #0088cc;
                        margin-top: 24px;
                        width: 100%;
                        text-align: center;
                    "
                    onmouseover="this.style.background='#0077b3';"
                    onmouseout="this.style.background='#0088cc';"
                >
                    <svg class="icon" width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="vertical-align: middle; margin-right: 8px;">
                    <path d="M256 8a248 248 0 1 0 0 496 248 248 0 1 0 0-496zM371 176.7c-3.7 39.2-19.9 134.4-28.1 178.3-3.5 18.6-10.3 24.8-16.9 25.4-14.4 1.3-25.3-9.5-39.3-18.7-21.8-14.3-34.2-23.2-55.3-37.2-24.5-16.1-8.6-25 5.3-39.5 3.7-3.8 67.1-61.5 68.3-66.7 .2-.7 .3-3.1-1.2-4.4s-3.6-.8-5.1-.5c-2.2 .5-37.1 23.5-104.6 69.1-9.9 6.8-18.9 10.1-26.9 9.9-8.9-.2-25.9-5-38.6-9.1-15.5-5-27.9-7.7-26.8-16.3 .6-4.5 6.7-9 18.4-13.7 72.3-31.5 120.5-52.3 144.6-62.3 68.9-28.6 83.2-33.6 92.5-33.8 2.1 0 6.6 .5 9.6 2.9 2 1.7 3.2 4.1 3.5 6.7 .5 3.2 .6 6.5 .4 9.8z"/></svg>
                    <span data-i18n="login_page.connect_button">Подключиться</span>
                </a>
              
              </div>
             </div>
            </div>
        `);
            FORM.init(link + '/api/v1/', '#login_form', '', 'login', '.login_submit', function (data, isOk) {
                if (isOk && data['access_token']) {
                    localStorage.setItem('token', data['access_token']);
                    localStorage.setItem('role', data['role']);

                    $.ajax({
                        beforeSend: function (xhr) {
                            xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                        },
                        url: link + '/api/v1/get_id',
                        type: 'GET',
                        success: function (response) {
                            let publisherId = response.data.id;
                            localStorage.setItem('publisherId', publisherId);
                        },
                        error: function () {
                            console.error('Не удалось получить publisherId');
                        },
                        complete: function () {
                            window.location.href = '/#/';
                            loadTrialStatus();
                        }
                    });

                } else {
                    $('.generic-error').removeClass('d-none');
                    $('.generic-error').text(data.message);
                }
            });
        }


        if (location.hash == '#login/after_forgot') {
            $('.generic-error').removeClass('d-none')
            $('.generic-error').text(__('login_page.email_sent'))
        }
        if (location.hash == '#login/after_changed') {
            $('.generic-error').removeClass('d-none')
            $('.generic-error').text(__('login_page.password_changed'))
        }

        if (location.hash == '#login/after_registration') {
            $('.generic-error').removeClass('d-none')
            $('.generic-error').text(__('login_page.email_confirmation_sent'))
        }
        if (location.hash == '#login/email_verified') {
            $('.generic-error').removeClass('d-none')
            $('.generic-error').text(__('login_page.email_verified'))
        }

    },
    logout: function () {
        localStorage.setItem('token', '');
        localStorage.setItem('publisherId', '');
        window.location.href = '/#login/';
    },
    reset_password: function () {
        $('.main').removeClass('aside_show');
        $('#content').html(`
<div class="settings-content user_form">
  <h4 class="title" data-i18n="reset_password.title">Сброс пароля</h4>
  <div id="form_reset_confirm">
   <div class="generic-error alert alert-primary d-none" data-i18n="reset_password.info_message">Придумайте новый пароль</div>
   
    <input type="hidden" name="email" >
        <input type="hidden" name="token" >

  
        <div class="form-group">
            <label data-i18n="reset_password.new_password">Новый пароль</label>
            <div class="input-button custom-mobile">
                <input type="password" name="password" id="edit_profile_pass" class="textfield input js-pass" data-i18n-placeholder="reset_password.new_password_placeholder" placeholder="Введите новый пароль">
                <div class="field-error down"></div>
                <div class="button only-icon js-view-pass">
                    <svg class="icon">
                        <use xlink:href="#icon-eye"></use>
                    </svg>
                </div>
                <div class="button regular js-gen-pass" data-i18n="buttons.generate">Сгенерировать</div>
            </div>
        </div>
        <div class="form-group">
            <label data-i18n="reset_password.confirm_password">Повторите новый пароль</label>
            <div class="input-button">
                <input type="password" name="password_confirmation" id="edit_profile_pass2" class="textfield input js-pass" data-i18n-placeholder="reset_password.confirm_password_placeholder" placeholder="Повторите новый пароль">
                <div class="field-error down"></div>
            </div>
        </div> 

   <button class="button submit" data-i18n="reset_password.reset_button">Сбросить</button>
   <div class="bottom form_links">
   <div class="links">
    <p><a href="#register_vibix/" data-i18n="login_page.register_button">Зарегистрироваться</a></p>
    <p><a href="#resend-confirmation/" data-i18n="login_page.resend_confirmation">Подтвердить email</a></p>
   </div>
  </div>
  </div>
 </div>
`);

        let parts = location.hash.split('/')[1].toString().split('?email=');
        $('#form_reset_confirm [name="email"]').val(decodeURIComponent(parts[1]));
        $('#form_reset_confirm [name="token"]').val(parts[0]);
        FORM.init(link + '/api/v1/', '#form_reset_confirm', '', 'reset-password', '.submit', function (data, isOk) {
            if (isOk) {
                window.location.href = '/#login/after_changed';
            } else {
                $('.generic-error').removeClass('d-none')
                $('.generic-error').text(data.message)
            }
        });

    },
    forgot_password: function () {
        $('.main').removeClass('aside_show');
        $('#content').html(`
<div class="settings-content user_form">
  <h4 class="title" data-i18n="reset_password.title">Сброс пароля</h4>
  <div id="form_forgot">
   <div class="generic-error alert alert-primary d-none"></div>
   <div class="form-group">
    <label for="reset_password_email" class="field-label required" data-i18n="login_page.email_label">Email</label>
    <div class="input-button">
     <input type="text" name="email" id="reset_password_email" class="textfield input" data-i18n-placeholder="login_page.email_placeholder" placeholder="укажите email, который вы указали при регистрации">
     <div class="field-error down"></div>
    </div>
   </div>
       <div class="form-group">
     <label data-i18n="login_page.captcha_label">Пожалуйста, подтвердите, что вы не являетесь автоматической программой.</label>
     <div class="captcha-control d-none">
             <div class="image">
        <img src="https://www.vibix.org/captcha/signup/?rand=1718235118" alt="Картинка защиты">
        <br>
        <div class="input-button">
         <input type="text" name="code" id="login_code" class="textfield input" autocomplete="off">
         <div class="field-error up"></div>
        </div>
       </div>
           </div>
    </div>
   <button class="button submit" data-i18n="reset_password.reset_button">Сбросить</button>
     <div class="bottom form_links">
   <div class="links">
    <p><a href="#register_vibix/" data-i18n="login_page.register_button">Зарегистрироваться</a></p>
    <p><a href="#resend-confirmation/" data-i18n="login_page.resend_confirmation">Подтвердить email</a></p>
   </div>
  </div>
  </div>
 </div>
`);
        FORM.init(link + '/api/v1/', '#form_forgot', '', 'forgot-password', '.submit', function (data, isOk) {
            if (isOk) {
                window.location.href = '/#login/after_forgot';
            } else {
                $('.generic-error').removeClass('d-none')
                $('.generic-error').text(data.message)
            }
        });

    },
    resend_confirmation: function () {
        $('.main').removeClass('aside_show');
        $('#content').html(`
<div class="settings-content user_form">
  <h4 class="title" data-i18n="login_page.resend_confirmation">Активация профиля по email</h4>
  <div id="resend_confirmation" >
   <div class="generic-error alert alert-primary d-none"></div>
   <div class="form-group">
    <label for="resend_confirmation_email" class="field-label required" data-i18n="login_page.email_label">Email</label>
    <div class="input-button">
     <input type="text" name="email" id="resend_confirmation_email" class="textfield input" data-i18n-placeholder="login_page.email_placeholder" placeholder="укажите email, который вы указали при регистрации">
     <div class="field-error down"></div>
    </div>
   </div>
   <div class="form-group d-none">
     <label data-i18n="login_page.captcha_label">Пожалуйста, подтвердите, что вы не являетесь автоматической программой.</label>
     <div class="captcha-control">
             <div class="image">
        <img src="https://www.vibix.org/captcha/signup/?rand=1718235318" alt="Картинка защиты">
        <br>
        <div class="input-button">
         <input type="text" name="code" id="login_code" class="textfield input" autocomplete="off">
         <div class="field-error up"></div>
        </div>
       </div>
           </div>
    </div>
   
   <button class="button submit" data-i18n="buttons.send">Выслать инструкции</button>
     <div class="bottom form_links">
       <div class="links">
        <p><a href="#register_vibix/" data-i18n="login_page.register_button">Зарегистрироваться</a></p>
        <p><a href="#forgot-password/" data-i18n="login_page.forgot_password">Восстановить пароль</a></p>
    </div>
   </div>
  </div>
 </div>
`);
        FORM.init(link + '/api/v1/email/', '#resend_confirmation', '', 'resend', '.submit', function (data, isOk) {
            if (isOk) {
                window.location.href = '/#login/after_registration';
            } else {
                $('.generic-error').removeClass('d-none')
                $('.generic-error').text(data.message)
            }
        });
    },


    rkn: function () {
        $('.main').addClass('aside_show');
        $('.aside-block__list li a').removeClass('active');
        $('#top-header').show();
        $('#top-header').html(__("rkn_page.rkn_info"))
        $('#rkn').addClass('active');

        let rknData = [];
        let showAll = false;
        let currentSort = {column: 'updated_at', direction: 'desc'};

        const formatDate = (dateStr) => {
            if (!dateStr) return '—';
            const date = new Date(dateStr);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

            if (d.getTime() === today.getTime()) {
                return 'сегодня в ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
            } else if (d.getTime() === yesterday.getTime()) {
                return 'вчера в ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
            } else {
                return String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + date.getFullYear();
            }
        };

        const formatDateShort = (dateStr) => {
            if (!dateStr) return '—';
            const date = new Date(dateStr);
            return String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + date.getFullYear();
        };

        const formatDateFull = (dateStr) => {
            if (!dateStr) return '—';
            const date = new Date(dateStr);
            return String(date.getDate()).padStart(2, '0') + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + date.getFullYear() + ', ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        };

        const isRecentChange = (dateStr) => {
            if (!dateStr) return false;
            const date = new Date(dateStr);
            const now = new Date();
            const diffHours = (now - date) / (1000 * 60 * 60);
            return diffHours <= 26;
        };


        const updateBadgeCount = (count) => {
            if (count > 0) {
                $('#rkn-count').text(count).show();
            } else {
                $('#rkn-count').hide();
            }
        };

        const renderSkeleton = () => {
            $('#rknContent').html(`
            <div class="skeleton-container">
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            </div>
        `);
        };

        const renderEmptyState = (checkedAt) => {
            const checkedText = checkedAt ? formatDateFull(checkedAt) : '—';
            $('#rknContent').html(`
            <div class="rkn-empty-state">
                <div class="rkn-empty-icon">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #55cca8;"></i>
                </div>
                <h3 class="rkn-empty-title">${__("rkn_page.table.empty_title")}</h3>
                <p class="rkn-empty-text">${__("rkn_page.table.empty_text")}</p>
                <p class="rkn-empty-checked">${__("rkn_page.table.empty_checked", {date: checkedText})}
            </div>
        `);
        };

        const renderErrorState = () => {
            $('#rknContent').html(`
                <div class="rkn-error-state">
                    <div class="rkn-error-icon">
                        <i class="fas fa-triangle-exclamation" style="font-size: 48px; color: #dc3545;"></i>
                    </div>
                    <h3 class="rkn-error-title">${__("rkn_page.error.load_failed")}</h3>
                    <button class="button submit" id="rknRetryBtn" style="margin-top: 16px;">${__("rkn_page.error.retry")}</button>
                </div>
            `);

            $('#rknRetryBtn').off('click').on('click', function () {
                loadRKNData();
            });
        };

        const renderTable = (data, checkedAt) => {
            if (!data || data.length === 0) {
                renderEmptyState(checkedAt);
                return;
            }

            let blockedCount = data.filter(item => item.status === 'blocked').length;
            updateBadgeCount(blockedCount);

            const sortedData = [...data].sort((a, b) => {
                let valA = a[currentSort.column] || '';
                let valB = b[currentSort.column] || '';
                if (currentSort.column === 'first_blocked_at' || currentSort.column === 'updated_at' || currentSort.column === 'last_checked_at') {
                    valA = new Date(valA).getTime();
                    valB = new Date(valB).getTime();
                }
                if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });

            let rowsHtml = '';
            sortedData.forEach(item => {
                const isRecent = isRecentChange(item.updated_at);
                const rowClass = isRecent ? 'rkn-row-recent' : '';
                const statusLabel = item.status === 'blocked' ? __("rkn_page.status.blocked") : __("rkn_page.status.unblocked");
                const statusBadge = item.status === 'blocked'
                    ? '<span class="status-badge status-red"><i class="fas fa-circle" style="font-size: 6px; margin-right: 6px; color: #dc3545;"></i> ' + statusLabel + '</span>'
                    : '<span class="status-badge status-green"><i class="fas fa-circle" style="font-size: 6px; margin-right: 6px; color: #28a745;"></i> ' + statusLabel + '</span>';

                rowsHtml += `
                    <tr class="${rowClass}">
                        <td><span class="rkn-domain">${item.domain}</span></td>
                        <td>${statusBadge}</td>
                        <td>${formatDateShort(item.first_blocked_at)}</td>
                        <td>${formatDateShort(item.updated_at)}</td>
                        <td>${formatDateShort(item.last_checked_at)}</td>
                    </tr>
                `;
            });

            const sortIndicator = (column) => {
                if (currentSort.column !== column) return '';
                return currentSort.direction === 'asc' ? ' ▼' : ' ▲';
            };

            let html = `
                <div class="rkn-table-wrapper">
                    <div class="rkn-table-header">
                        <div class="rkn-show-unblocked">
                            <input type="checkbox" id="rknShowUnblocked" ${showAll ? 'checked' : ''}>
                            <label for="rknShowUnblocked" data-i18n="rkn_page.table.show_unblocked">Показать ранее разблокированные</label>
                        </div>
                    </div>
                    <table class="table rkn-table">
                        <thead>
                            <tr>
                                <th class="rkn-sortable" data-column="domain"><span  data-i18n="rkn_page.table.domain">Домен</span>${sortIndicator('domain')}</th>
                                <th class="rkn-sortable" data-column="status"><span  data-i18n="rkn_page.table.status">Статус</span>${sortIndicator('status')}</th>
                                <th class="rkn-sortable" data-column="first_blocked_at"><span  data-i18n="rkn_page.table.first_blocked_at">Обнаружен</span>${sortIndicator('first_blocked_at')}</th>
                                <th class="rkn-sortable" data-column="updated_at"><span  data-i18n="rkn_page.table.updated_at">Обновлён</span>${sortIndicator('updated_at')}</th>
                                <th class="rkn-sortable" data-column="last_checked_at"><span data-i18n="rkn_page.table.last_checked_at">Проверен</span>${sortIndicator('last_checked_at')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            `;

            if (checkedAt) {
                const checkedText = formatDateFull(checkedAt);
                html += `
                    <div class="rkn-footer">
                        <span data-i18n="rkn_page.footer.schedule">Данные обновляются ежедневно в 06:00 МСК.</span>
                        <span data-i18n="rkn_page.footer.no_impact">Блокировка домена в реестре РКН не влияет на доступность видеоконтента для посетителей вашего сайта.</span>
                        <span class="rkn-footer-checked">${__("rkn_page.footer.checked_at", {date: checkedText})}</span>
                    </div>
                `;
            }

            if (blockedCount > 0) {
                const titleKey = blockedCount === 1 ? 'rkn_page.banner.title_one' : 'rkn_page.banner.title_few';
                const titleText = blockedCount === 1
                    ? __("rkn_page.banner.title_one", {count: blockedCount})
                    : (blockedCount >= 2 && blockedCount <= 4
                        ? __("rkn_page.banner.title_few", {count: blockedCount})
                        : __("rkn_page.banner.title_many", {count: blockedCount}));

                const checkedText = checkedAt ? formatDateFull(checkedAt) : '—';
                const bannerHtml = `
                    <div class="rkn-banner">
                        <div class="rkn-banner-icon">
                        </div>
                        <div class="rkn-banner-content">
                            <div class="rkn-banner-title">${titleText}</div>
                            <span class="rkn-banner-text" data-i18n="rkn_page.banner.checked_at"></span><span class="rkn-banner-text">${checkedText}</span>
                            <div class="rkn-banner-text" data-i18n="rkn_page.banner.disclaimer" style="margin-top: 5px;">Блокировка в реестре РКН не влияет на доступность контента на вашем сайте.</div>
                        </div>
                    </div>
                `;
                html = bannerHtml + html;
            }

            $('#rknContent').html(html);

            $('.rkn-sortable').off('click').on('click', function () {
                const column = $(this).data('column');
                if (currentSort.column === column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = column;
                    currentSort.direction = 'desc';
                }
                renderTable(data, checkedAt);
                applyTranslationsToPage();
            });

            $('#rknShowUnblocked').off('change').on('change', function () {
                showAll = $(this).is(':checked');
                loadRKNData();
            });
        };

        const loadRKNData = () => {
            renderSkeleton();

            const url = link + '/api/v1/publisher/rkn-blocks' + (showAll ? '?show=all' : '');

            $.ajax({
                url: url,
                type: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + localStorage.getItem('token')
                },
                success: function (response) {
                    if (response.success) {
                        const data = response.data || [];
                        let checkedAt = response.checked_at;
                        if (!checkedAt && data.length > 0 && data[0].last_checked_at) {
                            checkedAt = data[0].last_checked_at;
                        }

                        const blockedCount = data.filter(item => item.status === 'blocked').length;
                        updateBadgeCount(blockedCount);

                        if (data.length === 0) {
                            renderEmptyState(checkedAt);
                        } else {
                            renderTable(data, checkedAt);
                            applyTranslationsToPage();
                        }
                    } else {
                        renderErrorState();
                    }
                },
                error: function (xhr) {
                    if (xhr.status === 401) {
                        window.location.href = '#logout/';
                        return;
                    }
                    renderErrorState();
                }
            });
        };

        $('#content').html(`
        <div class="rkn_page">
             <div class="rkn-header">
                <h1 class="rkn-title" data-i18n="rkn_page.title">Блокировки РКН</h1>
                <p class="rkn-subtitle" data-i18n="rkn_page.subtitle">Проверка доменов по реестру запрещённых сайтов Роскомнадзора</p>
            </div>
            <div id="rknContent"></div>
        </div>
    `);

        loadRKNData();
    },

    catalog: function () {
        $('.aside-block__list li a').removeClass('active');
        $('.aside-toggle').removeClass('hidden');
        $('#top-header').hide();
        $('#catalog').addClass('active');

        if (!localStorage.getItem('publisherId')) {
            $.ajax({
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                },
                url: link + '/api/v1/get_id',
                type: 'GET',
                success: function (response) {
                    let publisherId = response.data.id;
                    localStorage.setItem('publisherId', publisherId);
                },
                error: function () {
                    console.error('Не удалось получить publisherId');
                },
            });
        }

        $('#content').html(`
        <form id="grid_filter" class="row" style="padding: 10px;"></form>
        <table id="DataTable" class="table table-striped"></table>
    `);

        const catalogColumns = [
            {
                data: "uploaded_at",
                title: __("catalog_page.columns.added"),
                responsivePriority: 99,
                width: "110px",
                render: function (data, type, row) {
                    if (row['uploaded_at'])
                        return `${row['uploaded_at']}`;

                    if (row['proposal_status'] === 'pending')
                        return `<span style="font-style: italic;" class="text-muted"> ${__("catalog_page.requested")}</span>`;

                    if (!row['uploaded_at'])
                        return `<span data-id="${row['id']}" class="req_ask" id="req_ask_button_${row['id']}">${__("catalog_page.request_button")}</span>`;

                    return '';
                }
            },
            {
                data: "id",
                title: window.innerWidth < 992 ? __("catalog_page.columns.request_voiceover") : "",
                responsivePriority: 2000,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    return `<span style="text-align: center;" video-id="${data}" title="${__("catalog_page.columns.request_voiceover")}" class="req_voiceover"></span>`;
                }
            },
            {
                data: "name",
                title: __("catalog_page.columns.title"),
                responsivePriority: 3,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    var arrayOfNames = [];
                    const currentLang = localStorage.getItem('app_lang') || 'ru';

                    let mainName = '';

                    if (currentLang === 'en') {
                        mainName = row.name_eng || row.name_original || row.name;
                    } else {
                        mainName = row.name || row.name_eng || row.name_original;
                    }

                    if (mainName) arrayOfNames.unshift(mainName);

                    if (row.name_original) {
                        arrayOfNames.push(`<span style="font-size: 12px;">${row.name_original}</span>`);
                    }

                    return arrayOfNames.join('<br>');
                }
            },

            {
                data: "info",
                title: window.innerWidth < 992 ? __("catalog_page.columns.about") : "",
                orderable: false,
                sorting: false,
            },
            {
                data: "id",
                title: window.innerWidth < 992 ? __("catalog_page.columns.json") : "",
                orderable: false,
                sorting: false,
                responsivePriority: 2001,
                render: function (data, type, row) {
                    const {iframe_base_url, ...filteredRow} = row;
                    return `<button title="${__("catalog_page.view_json")}" class="js-json button regular" onclick="showDataInModal('${encodeURIComponent(JSON.stringify(filteredRow))}')">json</button>`;
                }
            },
            {
                data: "genre",
                title: __("catalog_page.columns.genre"),
                orderable: false,
                sorting: false,
                responsivePriority: 2002
            },
            {
                data: "year",
                title: __("catalog_page.columns.year"),
                responsivePriority: 2003
            },
            {
                data: "country",
                title: __("catalog_page.columns.country"),
                responsivePriority: 2004,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    const countries = row.country;
                    if (!countries) return '';
                    const arrayOfCountries = countries.split(',');
                    return arrayOfCountries.join('<br>');
                }
            },
            {
                data: "imdb_rating",
                title: '<span title="IMDB">IMDB</span>',
                responsivePriority: 6
            },
            {
                data: "kp_rating",
                title: '<span title="' + __("catalog_page.columns.kp_rating") + '">КП</span>',
                responsivePriority: 5
            },
            {
                data: "kp_votes",
                title: '<span title="' + __("catalog_page.columns.kp_votes") + '">' + __("catalog_page.columns.kp_votes") + '</span>',
                responsivePriority: 9
            },

            {
                title: __("catalog_page.columns.imdb_id"),
                responsivePriority: 11,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    if (row.imdb_id) {
                        return `<a class="custom" style="white-space: nowrap;">
                        <span class="js-open-link" data-link="https://www.imdb.com/title/${row.imdb_id}/">${row.imdb_id}</span>
                        <span class="js-copy-id" data-copy="${row.imdb_id}" data-notification="${__("messages.copied")}">
                            <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
                                <path class="dark" d="M5.5 9.99739C5.5 7.72572 5.5 6.58989 6.2025 5.88406C6.90583 5.17822 8.03667 5.17822 10.3 5.17822H12.7C14.9625 5.17822 16.0942 5.17822 16.7967 5.88406C17.5 6.58989 17.5 7.72572 17.5 9.99739V14.0141C17.5 16.2857 17.5 17.4216 16.7967 18.1274C16.0942 18.8332 14.9625 18.8332 12.7 18.8332H10.3C8.03667 18.8332 6.90583 18.8332 6.2025 18.1274C5.5 17.4216 5.5 16.2857 5.5 14.0141V9.99739Z" fill="white"></path>
                                <path class="light" d="M3.47667 3.14341C2.5 4.11925 2.5 5.69091 2.5 8.83342V10.5001C2.5 13.6426 2.5 15.2142 3.47667 16.1901C3.99083 16.7051 4.67083 16.9484 5.66 17.0634C5.5 16.3634 5.5 15.4001 5.5 14.0134V9.99758C5.5 7.72592 5.5 6.59008 6.2025 5.88425C6.90583 5.17841 8.03667 5.17841 10.3 5.17841H12.7C14.0767 5.17841 15.0333 5.17841 15.7317 5.33675C15.6167 4.34258 15.3733 3.66008 14.8567 3.14341C13.8808 2.16675 12.3092 2.16675 9.16667 2.16675C6.02417 2.16675 4.4525 2.16675 3.47667 3.14341Z" fill="white"></path>
                            </svg>
                        </span>
                    </a>`;
                    }
                    return '';
                }
            },

            {
                title: __("catalog_page.columns.kp_id"),
                responsivePriority: 11,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    if (row.kp_id) {
                        return `<a class="custom" style="white-space: nowrap;">
                        <span class="js-open-link" data-link="https://www.kinopoisk.ru/film/${row.kp_id}/">${row.kp_id}</span>
                        <span class="js-copy-id" data-copy="${row.kp_id}" data-notification="${__("messages.copied")}">
                            <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
                                <path class="dark" d="M5.5 9.99739C5.5 7.72572 5.5 6.58989 6.2025 5.88406C6.90583 5.17822 8.03667 5.17822 10.3 5.17822H12.7C14.9625 5.17822 16.0942 5.17822 16.7967 5.88406C17.5 6.58989 17.5 7.72572 17.5 9.99739V14.0141C17.5 16.2857 17.5 17.4216 16.7967 18.1274C16.0942 18.8332 14.9625 18.8332 12.7 18.8332H10.3C8.03667 18.8332 6.90583 18.8332 6.2025 18.1274C5.5 17.4216 5.5 16.2857 5.5 14.0141V9.99739Z" fill="white"></path>
                                <path class="light" d="M3.47667 3.14341C2.5 4.11925 2.5 5.69091 2.5 8.83342V10.5001C2.5 13.6426 2.5 15.2142 3.47667 16.1901C3.99083 16.7051 4.67083 16.9484 5.66 17.0634C5.5 16.3634 5.5 15.4001 5.5 14.0134V9.99758C5.5 7.72592 5.5 6.59008 6.2025 5.88425C6.90583 5.17841 8.03667 5.17841 10.3 5.17841H12.7C14.0767 5.17841 15.0333 5.17841 15.7317 5.33675C15.6167 4.34258 15.3733 3.66008 14.8567 3.14341C13.8808 2.16675 12.3092 2.16675 9.16667 2.16675C6.02417 2.16675 4.4525 2.16675 3.47667 3.14341Z" fill="white"></path>
                            </svg>
                        </span>
                    </a>`;
                    }
                    return '';
                }
            },
            {
                title: window.innerWidth < 992 ? __("catalog_page.columns.preview") : "",
                responsivePriority: 12,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    const video_type = row.type;
                    let episodes = row.episodes;
                    const raw_voiceovers = row.voiceovers;
                    const voiceovers = {'v': __("modals.skin_default")};

                    if (raw_voiceovers && Array.isArray(raw_voiceovers)) {
                        raw_voiceovers.forEach(function (number) {
                            voiceovers['v' + number.id] = number.name;
                        });
                    }

                    episodes = JSON.stringify(episodes || {});
                    const voiceoversStr = JSON.stringify(voiceovers);
                    const publisherId = localStorage.getItem('publisherId') || '';

                    if (row.iframe_video_id && row.voiceovers && row.voiceovers.length > 0) {

                        const colorParams = getColorParams(1);
                        const insAttrs = `data-publisher-id="${publisherId}" data-type="${video_type === 'serial' ? 'series' : 'movie'}" data-id="${row.iframe_video_id}" data-design="1" ${colorParams}`;

                        return `<a class="danger" data-type="${video_type}" data-id="${row.id}" data-fancybox="ajax" data-tippy-content="${__("player.preview")}" data-ins-attrs='${insAttrs}'>
                                    <svg class="icon icon-preview"><use xlink:href="#icon-preview"></use></svg>
                                </a>
                                <script>
                                    var alldata_${row.id} = ${episodes};
                                    var list_voiceovers_${row.id} = ${voiceoversStr};
                                    var url_${row.id} = "${row.iframe_video_url}";
                                </script>`;
                    }
                    return '';
                }
            },
            {
                title: __("catalog_page.columns.code"),
                responsivePriority: 22,
                orderable: false,
                sorting: false,
                render: function (data, type, row) {
                    const video_type = row.type === 'serial' ? 'series' : 'movie';
                    const publisherId = localStorage.getItem('publisherId') || '';
                    if (row.iframe_video_id) {
                        return `<a href="#!" class="large js-copycode" 
                                  data-code='data-publisher-id="${publisherId}" data-type="${video_type}" data-id="${row.iframe_video_id}"' 
                                  data-tippy-content="${__("modals.copy_code")}">
                                <svg class="icon"><use xlink:href="#icon-copy"></use></svg>
                            </a>`;
                    }
                    return '';
                }
            }
        ];

        window.catalogTable = new DataTableManager({
            api: link + '/api/v1/catalog/',
            tableSelector: '#DataTable',
            filterSelector: '#grid_filter',
            tableSearch: true,
            lengthMenu: [[50, 100, 200, 500], [50, 100, 200, 500], [50, 100, 200, 500]],
            searchDelay: 2000,
            searchPlaceholder: __("catalog_page.search_placeholder"),
            order: [[1, 'desc']],
            columns: catalogColumns
        });

        $(document).on('click', '.page-link', function (e) {
            e.preventDefault();
            $('html, body').animate({
                scrollTop: $('.section').offset().top
            }, 500);
        });
    },
    statistics: function () {
        $('#top-header').show();
        $('#top-header').html(__("statistics_page.update_note"));

        $('.aside-block__list li a').removeClass('active');
        $('#statistics').addClass('active');

        $('#content').html(`
            <form id="grid_filter" class="row" style="padding: 10px;"></form>
            <table id="DataTable" class="table table-striped"></table>
        `);
        const originalInitTable = DataTableManager.prototype.initTable;

        DataTableManager.prototype.initTable = function () {
            if (this.api && this.api.includes('/statistics/publisher/')) {

                const self = this;

                this.req('columnsTable', {}, function (columns) {

                    columns = columns.map(col => {
                        if (col.data === 'revenue') {
                            return {
                                ...col,
                                responsivePriority: 0,
                                className: (col.className || '') + ' revenue-column',
                                render: function (data, type, row) {
                                    if (type === 'display') {
                                        const value = parseFloat(data) || 0;
                                        if (value === 0) {
                                            return `<span style="color: #6c757d;">
                                                        0.00$
                                                    </span>`;
                                        } else {
                                            return `<span style="color: #28a745;">
                                                ${value.toFixed(2)}$
                                            </span>`;
                                        }
                                    }
                                    return data;
                                }
                            };
                        }
                        return col;
                    });

                    self.columns = columns;
                    originalInitTable.call(self);
                });
            } else {
                originalInitTable.call(this);
            }
        };

        window.statisticsTable = new DataTableManager({
            api: link + '/api/v1/statistics/publisher/',
            tableSelector: '#DataTable',
            filterSelector: '#grid_filter',
            tableSearch: false,
            lengthMenu: [[20, 100], [20, 100]]
        });

        $(document).ready(function () {
            const $gridFilter = $('#grid_filter');
            $gridFilter.after(`
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin: 0 10px 10px 10px; align-items: center;">
                <button class="button regular quick-date" data-period="today" style="border: 1px solid gray;">${__("statistics_page.today")}</button>
                <button class="button regular quick-date" data-period="yesterday" style="border: 1px solid gray;">${__("statistics_page.yesterday")}</button>
                <button class="button regular quick-date" data-period="week" style="border: 1px solid gray;">${__("statistics_page.week")}</button>
                <button class="button regular" id="csv-export" style="border: 1px solid gray;">${__("statistics_page.export_csv")}</button>
                <button class="button regular" id="stats-reload" style="border: 1px solid gray;">${__("statistics_page.refresh_stats")}</button>
            </div>
        `);

            $(document).on('click', '.quick-date', function () {
                const period = $(this).data('period');
                const today = moment();
                let dateFrom, dateTo;

                switch (period) {
                    case 'today':
                        dateFrom = today.format('YYYY-MM-DD');
                        dateTo = today.format('YYYY-MM-DD');
                        break;
                    case 'yesterday':
                        dateFrom = today.clone().subtract(1, 'days').format('YYYY-MM-DD');
                        dateTo = today.clone().subtract(1, 'days').format('YYYY-MM-DD');
                        break;
                    case 'week':
                        dateFrom = today.clone().subtract(6, 'days').format('YYYY-MM-DD');
                        dateTo = today.format('YYYY-MM-DD');
                        break;
                    default:
                        return;
                }

                $gridFilter.find('input[name="filter.date_from"]').val(dateFrom);
                $gridFilter.find('input[name="filter.date_to"]').val(dateTo);

                $gridFilter.find('input[name="filter.date_from"]').each(function () {
                    if (this._flatpickr) {
                        this._flatpickr.setDate(dateFrom);
                    }
                });
                $gridFilter.find('input[name="filter.date_to"]').each(function () {
                    if (this._flatpickr) {
                        this._flatpickr.setDate(dateTo);
                    }
                });

                if (window.statisticsTable) {
                    window.statisticsTable.reload();
                }
            });

            $gridFilter.on('change', 'input[name="filter.date_from"]', function () {
                const $startDateInput = $(this);
                const $endDateInput = $(this).closest('div').next().find('input[name="filter.date_to"]');
                const startDate = moment($startDateInput.val());
                const endDate = moment($endDateInput.val());

                if (startDate.isValid() && endDate.isValid()) {
                    const diffMonths = endDate.diff(startDate, 'months', true);
                    if (diffMonths > 3) {
                        const newEndDate = startDate.clone().add(3, 'months');
                        $endDateInput.val(newEndDate.format('YYYY-MM-DD'));
                        if ($endDateInput[0] && $endDateInput[0]._flatpickr) {
                            $endDateInput[0]._flatpickr.setDate(newEndDate.format('YYYY-MM-DD'));
                        }
                    }
                }
                if (window.statisticsTable) window.statisticsTable.reload();
            });

            $gridFilter.on('change', 'input[name="filter.date_to"]', function () {
                const $endDateInput = $(this);
                const $startDateInput = $(this).closest('div').prev().find('input[name="filter.date_from"]');
                const startDate = moment($startDateInput.val());
                const endDate = moment($endDateInput.val());

                if (startDate.isValid() && endDate.isValid()) {
                    const diffMonths = endDate.diff(startDate, 'months', true);
                    if (diffMonths > 3) {
                        const newStartDate = endDate.clone().subtract(3, 'months');
                        $startDateInput.val(newStartDate.format('YYYY-MM-DD'));
                        if ($startDateInput[0] && $startDateInput[0]._flatpickr) {
                            $startDateInput[0]._flatpickr.setDate(newStartDate.format('YYYY-MM-DD'));
                        }
                    }
                }
                // if (window.statisticsTable) window.statisticsTable.reload();
            });
        });
    },
    referral: function () {
        $('#top-header').show();
        $('#top-header').html(__("referral_page.description"));

        $('.aside-block__list li a').removeClass('active');
        $('#referral').addClass('active');

        $('#content').html(`
            <div class="settings-content">
                <div class="referral-card" style="border-radius: 8px; text-align: center;">
                    <div id="referral-link-container">
                        <h1 class="title" style="margin-bottom: 20px; text-align: left;" data-i18n="referral_page.your_link">Ваша реферальная ссылка</h1>
                        <div class="input-group" style="display: flex; align-items: center; margin-bottom: 15px; flex-wrap: nowrap;">
                            
                            <input type="text" id="referral-link-input"  readonly 
                                   style="flex: 1; min-width: 200px;">
                            <button class="button outline" id="copy-referral-link" style="white-space: nowrap;" data-i18n="referral_page.copy_button">Копировать</button>
                        </div>
                    </div>
                    
                    <div id="referral-stats" style="display: none; margin-bottom: 30px;">
                        <h1 class="title" style="margin-bottom: 20px; text-align: left;" data-i18n="referral_page.overview">Обзор</h1>
                        <table class="table balance-table" style="margin-bottom: 20px;">
                            <thead>
                                <tr>
                                    <th data-i18n="referral_page.total_clicks">Всего переходов по ссылке</th>
                                    <th data-i18n="referral_page.total_referrals">Всего зарегистрированных рефералов</th>
                                    <th data-i18n="referral_page.total_reward">Вознаграждение (всё время)</th>
                                    <th style="width: 50%;"></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td id="stat-clicks">0</td>
                                    <td id="stat-referrals">0</td>
                                    <td id="stat-reward">0</td>
                                    <td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <div id="loading-message" style="display: none;">
                        <p data-i18n="referral_page.generating">Генерация реферальной ссылки...</p>
                    </div>
                </div>
                
                <h1 class="title" style="margin-bottom: 20px; text-align: left;" data-i18n="referral_page.your_referrals">Ваши рефералы</h1>
                
                <div style="margin-top: 30px;">
                    <form id="grid_filter" class="row" style="padding: 10px;"></form>
                    <table id="DataTable" class="table table-striped"></table>
                </div>
            </div>
    `);

        function loadReferralStats() {
            $.ajax({
                beforeSend: function (xhr, settings) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                },
                url: link + '/api/v1/referral/stat',
                type: 'GET',
                success: function (response) {
                    if (response.success && response.data) {
                        $('#stat-clicks').text(response.data.click || 0);
                        $('#stat-referrals').text(response.data.referrals || 0);
                        $('#stat-reward').text(response.data.reward || 0);
                        $('#referral-stats').show();
                    }
                },
                error: function (xhr) {
                    console.error('Ошибка загрузки статистики:', xhr);
                }
            });
        }

        $('#loading-message').show();
        $('#referral-link-container').hide();

        $.ajax({
            beforeSend: function (xhr, settings) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
            },
            url: link + '/api/v1/referral/code',
            type: 'POST',
            success: function (response) {
                $('#loading-message').hide();

                if (response.success && response.data && response.data.active === 1) {
                    const referralLink = `https://vibix.org/?ref=${response.data.code}`;
                    $('#referral-link-input').val(referralLink);
                    $('#referral-link-container').show();

                    loadReferralStats();
                } else {
                    $('#referral-link-container').html(`
                    <p style="color: #dc3545;" data-i18n="referral_page.link_unavailable">Реферальная ссылка временно недоступна</p>
                `).show();
                }
            },
            error: function (xhr) {
                $('#loading-message').hide();
                $('#referral-link-container').html(`
                <p style="color: #dc3545;" data-i18n="referral_page.error_loading">Произошла ошибка при получении реферальной ссылки</p>
            `).show();
            }
        });

        $('#copy-referral-link').on('click', function () {
            const referralInput = $('#referral-link-input')[0];
            referralInput.select();
            document.execCommand('copy');

            const originalText = $(this).text();
            $(this).text(__("referral_page.copied"));
            setTimeout(() => {
                $(this).text(originalText);
            }, 2000);
        });

        window.referralTable = new DataTableManager({
            api: link + '/api/v1/referral/',
            tableSelector: '#DataTable',
            filterSelector: '#grid_filter',
            tableSearch: false,
            lengthMenu: [[20, 100], [20, 100]]
        });
    },
    studio_statistics: function () {
        $('#top-header').show();
        $('#top-header').html(__("statistics_page.update_note"));

        $('.aside-block__list li a').removeClass('active');
        $('#studio_statistics').addClass('active');

        $('#content').html(`
        <form id="grid_filter" class="row" style="padding: 10px;"></form>
        <table id="DataTable" class="table table-striped"></table>>
    `);

        if (localStorage.getItem('role') === "studio") {
            window.studioStatisticsTable = new DataTableManager({
                api: link + '/api/v1/statistics/studios/',
                tableSelector: '#DataTable',
                filterSelector: '#grid_filter',
                tableSearch: false,
                lengthMenu: [[20, 100], [20, 100]]
            });

            $(document).ready(function () {
                const $gridFilter = $('#grid_filter');

                if ($('#csv-export').length === 0) {
                    $gridFilter.after(`
                    <div class="col-md-3 col-lg-2" style="float: left; width: auto; margin: 0 10px 10px 10px;">
                        <button class="button regular" id="csv-export" style="border: 1px solid gray;">${__("statistics_page.export_csv")}</button>
                    </div>
                    <div class="col-md-3 col-lg-2" style="float: left; width: auto; margin: 0 10px 10px 10px;">
                        <button class="button regular" id="stats-reload" style="border: 1px solid gray;">${__("statistics_page.refresh_stats")}</button>
                    </div>
                `);
                }

                $gridFilter.on('change', 'input[name="filter.date_from"]', function () {
                    const $startDateInput = $(this);
                    const $endDateInput = $(this).closest('div').next().find('input[name="filter.date_to"]');
                    const startDate = moment($startDateInput.val());
                    const endDate = moment($endDateInput.val());

                    if (startDate.isValid() && endDate.isValid()) {
                        const diffMonths = endDate.diff(startDate, 'months', true);
                        if (diffMonths > 3) {
                            const newEndDate = startDate.clone().add(3, 'months');
                            $endDateInput.val(newEndDate.format('YYYY-MM-DD'));
                        }
                    }
                    if (window.studioStatisticsTable) window.studioStatisticsTable.reload();
                });

                $gridFilter.on('change', 'input[name="filter.date_to"]', function () {
                    const $endDateInput = $(this);
                    const $startDateInput = $(this).closest('div').prev().find('input[name="filter.date_from"]');
                    const startDate = moment($startDateInput.val());
                    const endDate = moment($endDateInput.val());

                    if (startDate.isValid() && endDate.isValid()) {
                        const diffMonths = endDate.diff(startDate, 'months', true);
                        if (diffMonths > 3) {
                            const newStartDate = endDate.clone().subtract(3, 'months');
                            $startDateInput.val(newStartDate.format('YYYY-MM-DD'));
                        }
                    }
                    if (window.studioStatisticsTable) window.studioStatisticsTable.reload();
                });
            });
        } else {

            $('#content').html(`
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <span data-i18n="statistics_page.access_denied">У вас нет доступа к этой странице. Только пользователи с ролью "студия" могут просматривать статистику загруженного.</span>
            </div>
        `);
        }
    },
    instructions: function () {
        $('#top-header').show();
        $('#top-header').html(`
            <h3 class="alert-heading"><strong data-i18n="instructions_page.plugin_announcement"></strong></h3>
            <p data-i18n="instructions_page.plugin_message"> Рады сообщить вам о запуске нашего плагина для самого популярного среди паблишеров движка Datalife Engine.</p>
            <p> <span data-i18n="instructions_page.download_plugin">Скачать его можно тут</span> <a id="plugin_upgade"
                    style="    text-decoration: underline;    font-weight: 700;    color: #27aade;"
                    href="https://plugins.vibix.org/v1/vibix.zip">Vibix 3.8</a>. <span data-i18n="instructions_page.install_note">Установка через систему плагинов для DLE 13-18</span></p>
            <hr>
            <p><span data-i18n="instructions_page.support_message">Если остались вопросы или нужна помощь в установке и его работе, пишите нам в</span> <a
                    href="https://t.me/vibix_tv" target="_blank"><i class="fab fa-telegram"></i> Телеграм </a>.
            </p>
            <p class="mb-0" data-i18n="instructions_page.feedback_message">Также будем рады, если вы будете сообщать о багах и проблемах в его работе, а также рады принимать предложения по новому функционалу.</p>
        `)


        $('.aside-block__list li a').removeClass('active');
        $('#instructions').addClass('active');

        const menuItems = [
            {
                title: __("instructions_page.sections.plugin"),
                icon: "M96 0C78.3 0 64 14.3 64 32l0 96 64 0 0-96c0-17.7-14.3-32-32-32zM288 0c-17.7 0-32 14.3-32 32l0 96 64 0 0-96c0-17.7-14.3-32-32-32zM32 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l0 32c0 77.4 55 142 128 156.8l0 67.2c0 17.7 14.3 32 32 32s32-14.3 32-32l0-67.2C297 398 352 333.4 352 256l0-32c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 160z",
                links: [
                    {id: "v-2", text: __("instructions_page.links.install"), active: true},
                    {id: "v-3", text: __("instructions_page.links.select_movies")},
                    {id: "v-6", text: __("instructions_page.links.add_news")},
                    {id: "v-7", text: __("instructions_page.links.add_update")},
                    {id: "v-5", text: __("instructions_page.links.set_player_link")},
                    {id: "v-8", text: __("instructions_page.links.run_task")},
                    {id: "v-13", text: __("instructions_page.links.microdata")},
                ]
            },
            {
                title: __("instructions_page.sections.info"),
                icon: "M184 48l144 0c4.4 0 8 3.6 8 8l0 40L176 96l0-40c0-4.4 3.6-8 8-8zm-56 8l0 40L64 96C28.7 96 0 124.7 0 160l0 96 192 0 128 0 192 0 0-96c0-35.3-28.7-64-64-64l-64 0 0-40c0-30.9-25.1-56-56-56L184 0c-30.9 0-56 25.1-56 56zM512 288l-192 0 0 32c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32-14.3-32-32l0-32L0 288 0 416c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-128z",
                links: [
                    {id: "v-1", text: __("instructions_page.links.install_code")},
                    {id: "v-15", text: __("instructions_page.links.connect_player")},
                    {id: "v-12", text: __("instructions_page.links.player_design")},
                    {id: "v-9", text: __("instructions_page.links.api_docs")},
                    {id: "v-14", text: __("instructions_page.links.co_watch")},
                    {id: "v-17", text: __("instructions_page.links.trailer_show")},
                ]
            }
        ];

        $('#content').html(`
            <div class="settings">
                <div class="settings-wrapper">
                    <div class="settings-aside" role="tablist">
                        <nav class="settings-nav">
                            <ul>
                                ${menuItems.map(section => `
                                    <h3 class="title">
                                        <svg class="icon" width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                                            <path d="${section.icon}"/>
                                        </svg>
                                        ${section.title}
                                    </h3>
                                    ${section.links.map(link => `
                                        <li>
                                            <a id="${link.id}-tab" data-bs-toggle="pill" data-bs-target="#${link.id}" type="button" role="tab" aria-controls="${link.id}" class="nav-link ${link.active ? "underline" : ""}">
                                                ${link.text}
                                            </a>
                                        </li>
                                    `).join('')}
                                `).join('')}
                            </ul>
                        </nav>
                    </div>
                    <div class="tab-content instructions-content">
                        ${menuItems.flatMap(section => section.links).map(link => `
                            <div class="tab-pane fade ${link.active ? "show active" : ""}" id="${link.id}" role="tabpanel" aria-labelledby="${link.id}-tab"></div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `);

        menuItems.flatMap(section => section.links).forEach(link => {
            const lang = localStorage.getItem('app_lang') || 'ru';
            const url = `instructions/${lang}/${link.id}.html`;
            $(`#${link.id}`).load(url, function (response, status, xhr) {
                if (status === 'error' && lang !== 'ru') {
                    $(`#${link.id}`).load(`instructions/ru/${link.id}.html`);
                }
            });
        });
        $('#content').on('click', '.nav-link', function () {
            $('.nav-link').removeClass('active');
            $('.nav-link').removeClass('underline');
            $(this).addClass('active');
            $(this).addClass('underline');
            const target = $(this).data('bs-target');
            $('.tab-pane').removeClass('show active');
            $(target).addClass('show active');
            setPublisherId();
            updatePublisherId();
        });

    },

    finance: function () {
        $('.aside-block__list li a').removeClass('active');
        $('#finance').addClass('active');
        $('#top-header').show();
        $('#top-header').html(__("finance_page.payout_info"))

        const content = $('#content');

        content.html(`
        <div class="settings-content">
            <h1 class="title user_name" style="margin-bottom: 20px; text-align: left;">
                <span data-i18n="finance_page.welcome"></span>
                <span class="user_name_value"></span>
            </h1>
    
            <div class="balance-loading" style="text-align: left;" data-i18n="finance_page.loading">Загрузка данных...</div>
            
            <div class="balance-info" style="margin-bottom: 30px;">
                <table class="table balance-table" style="margin-bottom: 20px;">
                    <thead>
                        <tr>
                            <th data-i18n="finance_page.balance">Баланс</th>
                            <th data-i18n="finance_page.hold" style="white-space: nowrap;">В холде</th>
                            <th data-i18n="finance_page.available">Доступно</th>
                            <th data-i18n="finance_page.currency">Валюта</th>
                            <th data-i18n="finance_page.protocol"></th>
                            <th style="width: 15%;"></th>
                            <th style="width: 60%;"></th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
    
                <div class="balance-cards" style="display: none;"></div>
            </div>
           
            <h1 class="title" style="margin-bottom: 20px; text-align: left;" data-i18n="finance_page.history">История</h1>
            <div class="transaction-history"></div>
            
            <div class="modal fade" id="payoutModal" tabindex="-1" aria-labelledby="payoutModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h1 class="modal-title text-center w-100" id="payoutModalLabel" data-i18n="finance_page.payout_modal.title">Заказ выплаты</h1>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${__("modals.close")}"></button>
                        </div>
                        <div class="modal-body">
                            <div class="payout-info" style="line-height: 2;">
                                <table width="100%">
                                    <input id="user-id" type="hidden" value="example">
                                    <tr class="payout-row">
                                        <td><span data-i18n="finance_page.payout_modal.available">Доступно</span></td>
                                        <td style="text-align: right;">
                                            <span id="available-amount"></span>
                                            <span class="currency-label"></span>
                                        </td>
                                    </tr>
                                    <tr class="payout-row">
                                        <td><span data-i18n="finance_page.payout_modal.amount">Сумма</span></td>
                                        <td style="text-align: right;">
                                            <input type="text" id="payout-sum" value="0.00" 
                                                   style="width: 100px; text-align: right; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; height: 24px;">
                                            <span class="currency-label"></span>
                                        </td>
                                    </tr>
                                    <tr class="payout-row">
                                        <td><span data-i18n="finance_page.payout_modal.fee">Комиссия</span></td>
                                        <td style="text-align: right;">
                                            <span id="fee-percent"></span>
                                            <span id="fee-amount"></span>
                                            <span class="currency-label"></span>
                                        </td>
                                    </tr>
                                    <tr class="payout-row total">
                                        <td><span data-i18n="finance_page.payout_modal.to_receive"></span></td>
                                        <td style="text-align: right;">
                                            <span id="total-amount"></span>
                                            <span class="currency-label"></span>
                                        </td>
                                    </tr>
                                    <tr class="payout-row total">
                                        <td><span data-i18n="finance_page.payout_modal.wallet"></span></td>
                                        <td style="text-align: right;">
                                            <span id="wallet"></span>
                                        </td>
                                     </tr>
                                </table>
                            </div>
                        </div>
                        <div class="modal-footer" style="display: flex; justify-content: center;">
                            <button type="button" class="button submit" id="confirm-payout" data-i18n="finance_page.payout_modal.confirm"></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

        loadBalance();
        loadTransactions();

        $('#payout-sum').on('input', function () {
            let available = $('#available-amount').text();
            let val = $(this).val().replace(/[^0-9.]/g, '');
            let parts = val.split('.');
            if (parts.length > 2) {
                val = parts[0] + '.' + parts[1];
            }
            $(this).val(val);

            let num = parseFloat(val);
            let isValid = !isNaN(num) && typeof available !== 'undefined' && num >= 50 && num <= available && 50 <= available;
            $('#confirm-payout').prop('disabled', !isValid);
        });

        content.off('click', '#request-payout').on('click', '#request-payout', function () {
            new bootstrap.Modal(document.getElementById('payoutModal')).show();

            $.ajax({
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                },
                url: '/api/v1/user/balance',
                type: 'GET',
                success: (response) => {
                    const available = parseFloat(response.data.available || 0).toFixed(2);
                    const feePercent = 0;
                    const feeAmount = (available * feePercent / 100).toFixed(2);
                    const total = (available - feeAmount).toFixed(2);
                    const currency = response.data.currency || '';
                    const userID = response.data.user_id || '';
                    let wallet = response.data.wallet || __("finance_page.payout_modal.not_set");

                    wallet = (wallet !== __("finance_page.payout_modal.not_set") && wallet.length >= 10)
                        ? wallet.slice(0, 6) + '*'.repeat(wallet.length - 10) + wallet.slice(-4)
                        : wallet;

                    $('#user-id').val(userID);
                    $('#available-amount').text(available);
                    $('#payout-sum').val(available);
                    $('.currency-label').each(function () {
                        $(this).text(currency);
                    });
                    $('#fee-percent').text('');
                    $('#fee-amount').text(feeAmount);
                    $('#total-amount').text(total);
                    $('#wallet').text(wallet);

                    let isValid = 50 <= available;
                    $('#confirm-payout').prop('disabled', !isValid);
                },
                error: () => {
                    $('.modal-body').text(__("errors.generic"));
                }
            });
        });

        content.off('click', '#confirm-payout').on('click', '#confirm-payout', function () {
            const amount = parseFloat($('#payout-sum').val());
            const userID = $('#user-id').val();

            $.ajax({
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                },
                crossDomain: true,
                url: '/api/v1/user/payouts',
                type: 'POST',
                data: JSON.stringify({
                    "amount": amount,
                    "payment_method": "bank",
                    "payment_details": {
                        "account_number": userID,
                        "bank_name": "Example Bank"
                    }
                }),
                contentType: "application/json; charset=utf-8",
                dataType: 'json',
                success: (response) => {
                    document.activeElement.blur();
                    bootstrap.Modal.getOrCreateInstance('#payoutModal').hide();
                    showGlobalToast(__("messages.payout_request_sent"), 'success');
                    loadBalance();
                    loadTransactions();
                    if (window.transactionsTable) window.transactionsTable.reload();
                },
                error: (error) => {
                    showGlobalToast(__("messages.payout_error"), 'error');
                }
            });
        });

        function loadBalance() {
            $('.balance-info').hide();
            $('.balance-loading').show().text(__("finance_page.loading"));

            $.ajax({
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                },
                url: '/api/v1/settings',
                type: 'GET',
                success: (response) => {
                    let name = response.data.name;
                    $('.user_name_value').text(name ? ', ' + name + '!' : '!');
                }
            });

            $.ajax({
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
                },
                url: '/api/v1/user/balance',
                type: 'GET',
                success: (response) => {
                    $('.balance-loading').hide();
                    $('.balance-info').show();

                    const balanceTableHTML = `
                    <tr>
                        <td>${response.data.balance || 0}</td>
                        <td>${response.data.hold || 0}</td>
                        <td>${response.data.available || 0}</td>
                        <td>${response.data.currency || ''}</td>
                        <td>${response.data.payment_protocol || ''}</td>
                        <td><button class="button outline" id="request-payout" style="white-space: nowrap;" data-i18n="finance_page.request_payout"></button></td>
                        <td style="text-align: center; vertical-align: middle;">
                            ${response.data.total_reward > 0 ?
                        `<h1 class="welcome-title">${__("finance_page.total_earned")} <span style="color: #55CCA8;">${__("finance_page.from_vibix")}</span> ${response.data.total_reward} ${response.data.currency}</h1>` :
                        ''}
                        </td>
                    </tr>
                `;

                    $('.balance-table tbody').html(balanceTableHTML);

                    const balanceCardHTML = `
                    <div class="balance-card">
                        <div><strong>${__("finance_page.balance")}:</strong> ${response.data.balance || 0}</div>
                        <div><strong>${__("finance_page.hold")}:</strong> ${response.data.hold || 0}</div>
                        <div><strong>${__("finance_page.available")}:</strong> ${response.data.available || 0}</div>
                        <div><strong>${__("finance_page.currency")}:</strong> ${response.data.currency || ''}</div>
                        <div><button class="button outline" id="request-payout" style="white-space: normal;" data-i18n="finance_page.request_payout"></button></div>
                        ${response.data.total_reward > 0 ?
                        `<div style="text-align: center;">
                                <h1 class="welcome-title">${__("finance_page.total_earned")} <span style="color: #55CCA8;">${__("finance_page.from_vibix")}</span> ${response.data.total_reward} ${response.data.currency}</h1>
                            </div>` :
                        ''}
                    </div>
                `;

                    $('.balance-cards').html(balanceCardHTML);
                    applyTranslationsToPage();
                },
                error: () => {
                    $('.balance-loading').text(__("errors.generic"));
                }
            });
        }

    },


    profile: function () {
        $('#top-header').hide();

        $('.aside-block__list li a').removeClass('active');
        $('#profile').addClass('active');
        $('#content').html(`<div class="settings">
                <div class="settings-wrapper">
                    <div class="settings-aside" role="tablist">
                        <h3 class="title">
                            <svg class="icon">
                                <use xlink:href="#icon-aside-work"></use>
                            </svg>
                            <span data-i18n="profile_page.info_section"></span>
                        </h3>
                        <nav class="settings-nav">
                            <ul>
                                <li><a id="v-1-tab" class="active" data-bs-toggle="pill" data-bs-target="#v-1" type="button" role="tab" aria-controls="v-1" aria-selected="true" data-i18n="profile_page.tabs.profile"></a></li>
                                <li><a id="v-2-tab" data-bs-toggle="pill" data-bs-target="#v-2" type="button" role="tab" aria-controls="v-2" aria-selected="false" data-i18n="profile_page.tabs.change_password"></a></li>
                                <li><a id="v-4-tab" data-bs-toggle="pill" data-bs-target="#v-4" type="button" role="tab" aria-controls="v-4" aria-selected="false" class="current_" data-i18n="profile_page.tabs.profile_display"></a></li>
                            </ul>
                        </nav>
<!--                        <h3 class="title">-->
<!--                            <svg class="icon">-->
<!--                                <use xlink:href="#icon-aside-settings"></use>-->
<!--                            </svg>-->
<!--                            <span data-i18n="profile_page.tabs.copy_settings"></span>-->
<!--                        </h3>-->
<!--                        <nav class="settings-nav">-->
<!--                            <ul>-->
<!--                                <li><a id="v-3-tab" data-bs-toggle="pill" data-bs-target="#v-3" type="button" role="tab" aria-controls="v-3" aria-selected="false" class="current_" data-i18n="profile_page.tabs.copy_settings"></a></li>-->
<!--                                <li><a id="v-4-tab" data-bs-toggle="pill" data-bs-target="#v-4" type="button" role="tab" aria-controls="v-4" aria-selected="false" class="current_" data-i18n="profile_page.tabs.profile_display"></a></li>-->
<!--                            </ul>-->
<!--                        </nav>-->
                    </div>
                    <div class="settings-content">
                        <div class="tab-content">
                            <div class="tab-pane fade show active profile_fields" id="v-1" role="tabpanel" aria-labelledby="v-2-tab">
                                <h4 class="title" data-i18n="profile_page.info_section"></h4>
                                <div class="form-group">
                                    <label data-i18n="profile_page.name_label"></label>
                                    <div class="input-button">
                                        <div class="message">
                                            <p data-i18n="profile_page.name_change_hint"></p>
                                            <svg class="icon">
                                                <use xlink:href="#icon-submess"></use>
                                            </svg>
                                        </div>
                                        <input name="name" class="input" disabled="" type="text" value="">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label data-i18n="profile_page.email_label">Email (используется для входа)</label>
                                    <div class="input-button">
                                        <div class="message">
                                            <p data-i18n="profile_page.email_change_hint">Для смены email обратитесь в поддержку</p>
                                            <svg class="icon">
                                                <use xlink:href="#icon-submess"></use>
                                            </svg>
                                        </div>
                                        <input class="input" name="email" disabled="" type="text" value="">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label data-i18n="profile_page.sites_label">Сайты</label>
                                    <div class="input-button">
                                        <div class="message">
                                            <p data-i18n="profile_page.sites_change_hint">Для смены сайтов обратитесь в поддержку</p>
                                            <svg class="icon">
                                                <use xlink:href="#icon-submess"></use>
                                            </svg>
                                        </div>
                                        <input name="sites" class="input" disabled="" type="text" value="">
                                    </div>
                                </div>
                                
                                <div class="form-group">
                                    <label data-i18n="profile_page.cpm_label">CPM</label>
                                    <div class="input-button">
                                        <div class="message">
                                            <p data-i18n="profile_page.cpm_hint">Подробнее о формировании cpm уточняйте в тех поддержке</p>
                                            <svg class="icon">
                                                <use xlink:href="#icon-submess"></use>
                                            </svg>
                                        </div>
                                        <input class="input" name="cpm" disabled="" type="text" value="">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label data-i18n="profile_page.wallet_label">Кошелек для выплат</label>
                                    <div class="input-button">
                                        <div class="message">
                                            <p data-i18n="profile_page.wallet_change_hint">Для смены кошелька обратитесь в поддержку</p>
                                            <svg class="icon">
                                                <use xlink:href="#icon-submess"></use>
                                            </svg>
                                        </div>
                                        <input class="input" name="wallet" disabled="" type="text" value="">
                                    </div>
                                </div>
                                <div id="user_tokens" class="form-group" data-v-app="">
                                    <label data-i18n="profile_page.api_token_label">Api Token</label>
                                    <div class="input-button custom-mobile">
                                        <input type="text" id="api_token" class="textfield input" data-i18n-placeholder="profile_page.api_token_placeholder" placeholder="" value="" readonly="readonly">
                                        <div class="field-error down"></div>
                                        <div class="button regular js-gen-api2" data-i18n="profile_page.generate_button">Сгенерировать</div>
                                    </div>
                                </div>
                                
                                <div class="info-note">
                                    <p data-i18n="profile_page.token_note">
                                        Запишите полученный токен.
                                    </p>
                                </div>
                                <div class="form-group">
                                    <label data-i18n="profile_page.policies_title">Политики и соглашения</label>
                                    <a href="politics/TermsofService.html" target="_blank" style="text-decoration: underline;" data-i18n="profile_page.terms_of_service">Пользовательское соглашение</a><br>
                                    <a href="politics/PrivacyPolicy.html" target="_blank" style="text-decoration: underline;" data-i18n="profile_page.privacy_policy">Политика конфиденциальности</a><br>
                                    <a href="politics/PersonalData.html" target="_blank" style="text-decoration: underline;" data-i18n="profile_page.personal_data_policy">Политика в отношении обработки персональных данных</a><br>
                                    
                                </div>
                            </div>
                            <div class="tab-pane fade change_password" id="v-2" role="tabpanel" aria-labelledby="v-3-tab">
                                <h4 class="title" data-i18n="profile_page.password_section">Изменение пароля</h4>
                                <div class="generic-error alert alert-primary d-none"></div>
                                <div>
                                    <div class="form-group">
                                        <label data-i18n="profile_page.old_password">Старый пароль</label>
                                        <div class="input-button">
                                            <input type="password" name="current_password" id="edit_profile_old_pass" class="textfield input js-old_pass" data-i18n-placeholder="profile_page.old_password_placeholder" placeholder="Введите старый пароль">
                                            <div class="field-error down"></div>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label data-i18n="profile_page.new_password">Новый пароль</label>
                                        <div class="input-button custom-mobile">
                                            <input type="password" name="new_password" id="edit_profile_pass" class="textfield input js-pass" data-i18n-placeholder="profile_page.new_password_placeholder" placeholder="Введите новый пароль">
                                            <div class="field-error down"></div>
                                            <div class="button only-icon js-view-pass">
                                                <svg class="icon">
                                                    <use xlink:href="#icon-eye"></use>
                                                </svg>
                                            </div>
                                            <div class="button regular js-gen-pass" data-i18n="buttons.generate">Сгенерировать</div>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label data-i18n="profile_page.confirm_password">Повторите новый пароль</label>
                                        <div class="input-button">
                                            <input type="password" name="new_password_confirmation" id="edit_profile_pass2" class="textfield input js-pass" data-i18n-placeholder="profile_page.confirm_password_placeholder" placeholder="Повторите новый пароль">
                                            <div class="field-error down"></div>
                                        </div>
                                    </div>
                                    <button class="button submit" data-i18n="profile_page.change_password_button">Изменить пароль</button>
                                </div>
                            </div>
                            <div class="tab-pane fade profile_fields" id="v-3" role="tabpanel" aria-labelledby="v-1-tab">
                                <h4 class="title" data-i18n="profile_page.copy_settings_section">Настройки копирования кода</h4>
                                          <div class="generic-error alert alert-primary d-none"></div>
                                <h4 class="title small" data-i18n="profile_page.width_height">Ширина и высота</h4>
                                <div class="info-note">
                                    <p data-i18n="profile_page.settings_note">
                                        Данные настройки применяются к коду, который будет копироваться из базы при нажатии кнопки "копировать код". При этом опции "копировать только ссылку" и "ссылка на страницу" сверху справа должны быть выключены.
                                    </p>
                                </div>
                                <div>
                                    <div class="player-sizes">
                                        <div class="form-group">
                                            <label data-i18n="profile_page.width_label">Ширина</label>
                                            <div class="input-button">
                                                <input name="copy_width" class="input" id="width" type="text" value="100%" data-i18n-placeholder="profile_page.width_placeholder" placeholder="Введите ширину плеера">
                                            </div>
                                        </div>
                                        <div class="form-group">
                                            <label data-i18n="profile_page.height_label">Высота</label>
                                            <div class="input-button">
                                                <input name="copy_height" class="input" id="height" type="text" value="370" data-i18n-placeholder="profile_page.height_placeholder" placeholder="Введите высоту плеера">
                                            </div>
                                        </div>
                                    </div>
                                    <div class="info-note">
                                        <p data-i18n="profile_page.size_hint">
                                            Размер можно указывать как просто числом (<code>670</code>), так и вместе с единицей измерения (<code>670px</code>, <code>670%</code>).
                                        </p>
                                    </div>
                                    <h4 class="title small" data-i18n="profile_page.templates_title">Шаблоны</h4>
                                    <div class="info-note">
                                        <p data-i18n="profile_page.templates_note">
                                            Шаблоны можно использовать для того, чтобы копируемая ссылка была сразу в нужном вам виде. В обоих шаблонах для определения места вставки нужно использовать код <code>{link}</code>.
                                        </p>
                                    </div>
                                    <div class="form-group">
                                        <label data-i18n="profile_page.single_link_template">Шаблон для копирования одной ссылки</label>
                                        <div class="input-button full-width">
                                            <textarea name="copy_template" class="textarea" id="custom2" maxlength="1024" rows="1" cols="50"></textarea>
                                        </div>
                                    </div>
                  
                                    <button class="button full-width submit" data-i18n="profile_page.save_button">Сохранить</button>
                                </div>
                            </div>
                            <div class="tab-pane fade profile_fields" id="v-4" role="tabpanel" aria-labelledby="v-1-tab">
                                <h4 class="title" data-i18n="profile_page.profile_display_section">Показ профиля и статистики</h4>
                                          <div class="generic-error alert alert-primary d-none"></div>
                                <div class="info-note">
                                    <p data-i18n="profile_page.profile_display_note">
                                        Данные настройки применяются к показу профиля и статистики в плагине DLE
                                    </p>
                                </div>
                                <div>
                                    <div class="form-group">
                                        <label for="dle_allow_user_data">
                                            <input type="checkbox" value="1" id="dle_allow_user_data" name="dle_allow_user_data" />&nbsp;&nbsp;<span data-i18n="profile_page.display_checkbox">Отображать профиль и статистику</span>
                                        </label>
                                    </div>                      
                                    <button class="button full-width submit" data-i18n="profile_page.save_button">Сохранить</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal fade" id="confirmModal" tabindex="-1" aria-labelledby="confirmModalLabel" aria-hidden="true">
                  <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                      <div class="modal-header">
                        <h3 class="modal-title text-center w-100" id="confirmModalLabel" data-i18n="profile_page.domain_confirm">Подтверждение</h3>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${__("modals.close")}"></button>
                      </div>
                      <div class="modal-body js_remove_domain_confirm text-center w-100">
                        
                      </div>
                      <div class="modal-footer" style="display: flex; justify-content: center; align-items: center;">
                        <button type="button" class="button submit" id="remove_domain_confirm" data-i18n="profile_page.confirm_button">Подтвердить</button>
                      </div>
                    </div>
                  </div>
                </div>
            </div>`);
        $('#api_token').val(localStorage.getItem('api_token'));
        FORM.init(link + '/api/v1/', '.profile_fields', 'settings', 'settings', '.submit', function (data, isOk) {
            if (isOk) {
                window.location.href = '/#profile/';
                $('.profile_fields .generic-error').removeClass('d-none')
                $('.profile_fields .generic-error').text(__("profile_page.settings_saved"))
            } else {
                $('.profile_fields .generic-error').removeClass('d-none')
                $('.profile_fields .generic-error').text(data.message)
            }
        });
        $('.change_password .submit').click(function () {
            var data = {
                "current_password": $('.change_password [name="current_password"]').val(),
                "new_password": $('.change_password [name="new_password"]').val(),
                "new_password_confirmation": $('.change_password [name="new_password_confirmation"]').val()
            };
            $.ajax({
                beforeSend: function (xhr, settings) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                },
                type: "POST",
                crossDomain: true,
                url: link + '/api/v1/change-password',
                data: JSON.stringify(data),
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function (data) {
                    $('.change_password .generic-error').removeClass('d-none');
                    $('.change_password .generic-error').text(__("profile_page.password_changed"));
                },
                error: function (errMsg) {
                    $('.change_password .generic-error').removeClass('d-none')
                    $('.change_password .generic-error').text(errMsg['responseJSON']['message'])
                }
            });
        });

        $('.profile_fields .js-gen-api2').click(function () {

            $.ajax({
                beforeSend: function (xhr, settings) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                },
                type: "GET",
                crossDomain: true,
                url: link + '/api/v1/token/regenerate',
                data: null,
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function (res) {
                    api_token = res.data.token;
                    $('#api_token').val(api_token);
                    localStorage.setItem('api_token', api_token);
                },
                error: function (errMsg) {

                }
            });
        });

        function refreshDomainStatus(id, name) {

            const $domainButton = $(`#${id}`);
            const $domainRetry = $(`#${id}_error`);
            $.ajax({
                beforeSend: function (xhr, settings) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                },
                type: "PUT",
                crossDomain: true,
                url: link + '/api/v1/domain/' + id,
                data: JSON.stringify({
                    "name": name,
                    "status": "new"
                }),
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function (res) {
                    $domainButton.html(`
                        <span>${name}</span>
                        <span style="color: dodgerblue"> ${__("domains.status_new")} </span>
                        <span style="font-size: 10px; color: grey;">&nbsp;✖</span>
                    `);
                    $domainRetry.html(`
                        <a 
                            href="https://www.whatsmydns.net/dns-lookup/cname-records?query=${name}&server=google"
                            target="_blank"
                        >
                        <span>${__("domains.check_status")}</span>
                        </a> 
                    `);


                },
                error: function (errMsg) {
                }
            });
        }

        function getDomains() {
            const $iframeDomains = $('#iframe_domains');
            const statusDescriptions = {
                new: __("domains.status_new"),
                dns_pending: __("domains.status_dns_pending"),
                dns_failed: '',
                nginx_pending: __("domains.status_nginx_pending"),
                nginx_failed: __("domains.status_nginx_pending"),
                ssl_pending: __("domains.status_ssl_pending"),
                ssl_failed: '',
                nginx_ssl_pending: __("domains.status_nginx_pending"),
                nginx_ssl_failed: '',
                active: __("domains.status_active"),
                suspended: __("domains.status_suspended"),
                deleted: __("domains.status_deleted")
            };
            const statusesWithError = ['dns_failed', 'ssl_failed'];
            const statusesNew = ['new'];
            const statusesActive = ['active'];
            const statusesWhatsmydns = ['new', 'dns_failed', 'dns_pending'];


            function getStatusDescription(status, lastError = '') {
                if (statusesWithError.includes(status) && lastError) {
                    return `<span style="color: red"> ` + statusDescriptions[status] + lastError + `</span>`
                }
                if (statusesNew.includes(status)) {
                    return `<span style="color: dodgerblue"> ` + statusDescriptions[status] + `</span>`
                }
                if (statusesActive.includes(status)) {
                    return `<span style="color: green"> ` + statusDescriptions[status] + `</span>`
                }
                return `<span style="color: blue"> ` + statusDescriptions[status] + `</span>` || 'Неизвестный статус';
            }

            $.ajax({
                beforeSend: function (xhr, settings) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                },
                type: "GET",
                crossDomain: true,
                url: link + '/api/v1/domain',
                data: null,
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function (res) {
                    $('#user_domain .field-error').text("")
                    $iframeDomains.empty();
                    $.each(res.data, function (index, value) {
                        let domainStatus = '';
                        if (value.status) {
                            domainStatus = getStatusDescription(value.status, value.last_error);
                        }

                        if (value.name) {
                            if (statusesWithError.includes(value.status)) {
                                $iframeDomains.append(`
                                <div style="margin-bottom: 10px;">
                                    <button 
                                        class="js-remove-domain button regular" 
                                        data-bs-toggle="modal" 
                                        data-bs-target="#confirmModal" 
                                        style="display: inline-block; margin-right: 10px;"
                                        id="${value.id}"
                                        name="${value.name}">
                                        <span>${value.name}</span>
                                        ${domainStatus}
                                        <span style="font-size: 10px; color: grey; ">&nbsp;✖</span>
                                    </button>
                                    
                                    <button 
                                        class="js-remove-domain button regular" 
                                        style="display: inline-block;"
                                        id="${value.id}_error"
                                        name="${value.name}_error">
                                        <span>${__("buttons.retry")}</span>
                                    </button>

                                </div>
                                `);

                                setTimeout(() => {
                                    $(`#${value.id}_error`).on('click', function () {
                                        refreshDomainStatus(value.id, value.name);
                                    });
                                }, 0);
                            } else if (statusesWhatsmydns.includes(value.status)) {
                                $iframeDomains.append(`
                                <div style="margin-bottom: 10px;">
                                    <button 
                                            class="js-remove-domain button regular" 
                                            data-bs-toggle="modal" 
                                            data-bs-target="#confirmModal" 
                                            style="display: inline-block; margin-right: 10px;"
                                            id="${value.id}"
                                            name="${value.name}">
                                            <span>${value.name}</span>
                                            ${domainStatus}
                                            <span style="font-size: 10px; color: grey; ">&nbsp;✖</span>
                                    </button>
                                    
                                    <a 
                                        href="https://www.whatsmydns.net/dns-lookup/cname-records?query=${value.name}&server=google" 
                                        class="js-remove-domain button regular" 
                                        style="display: inline-block;"
                                        target="_blank"
                                    >
                                        <span>${__("domains.check_status")}</span>
                                    </a>
                                </div>    
                                `);

                                setTimeout(() => {
                                    $(`#${value.id}_error`).on('click', function () {
                                        refreshDomainStatus(value.id, value.name);
                                    });
                                }, 0);

                            } else {
                                $iframeDomains.append(`
                                <button 
                                    class="js-remove-domain button regular" 
                                    data-bs-toggle="modal" 
                                    data-bs-target="#confirmModal" 
                                    style="display: block; margin-bottom: 10px;"
                                    id="${value.id}"
                                    name="${value.name}">
                                    <span>${value.name}</span>
                                    ${domainStatus}
                                    <span style="font-size: 10px; color: grey">&nbsp;✖</span>
                                </button>
                                `);
                            }
                        }
                    });
                },
                error: function (errMsg) {
                }
            });
        }


        $(document).ready(getDomains());

        $('.js-add-domain').click(function () {
            const domain_name = $('#iframe_domain').val();
            $.ajax({
                beforeSend: function (xhr, settings) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                },
                type: "POST",
                crossDomain: true,
                url: link + '/api/v1/domain',
                data: JSON.stringify({"name": domain_name}),
                contentType: "application/json; charset=utf-8",
                dataType: "json",
                success: function (res) {
                    $('#user_domain .field-error').text("")
                    getDomains()
                },
                error: function (errMsg) {
                    $('#user_domain .field-error').text(errMsg['responseJSON']['message'])
                }
            });

        });

        $('#iframe_domains').on('click', '.js-remove-domain', function () {
            let $removeDomainConfirm = $('#remove_domain_confirm');
            let id = $(this).attr('id');
            let name = $(this).attr('name');
            $('.js_remove_domain_confirm').text(__("profile_page.domain_confirm_text") + ' ' + name + '?')
            $removeDomainConfirm.off('click');
            $removeDomainConfirm.click(function () {
                $.ajax({
                    beforeSend: function (xhr, settings) {
                        xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
                    },
                    type: "DELETE",
                    crossDomain: true,
                    url: link + '/api/v1/domain/' + id,
                    data: null,
                    contentType: "application/json; charset=utf-8",
                    dataType: "json",
                    success: function (res) {
                        const modal = bootstrap.Modal.getInstance(document.getElementById('confirmModal'));
                        document.activeElement.blur();
                        modal.hide();
                        $("#" + id).remove();
                    },
                    error: function (errMsg) {
                    }
                });
            });
            $('#user_domain .field-error').text("");
        });
    }
}

function loadTransactions() {
    $('.transaction-history').html(`
        <form id="transactions_filter" class="row" style="padding: 10px;"></form>
        <table id="transactions_table" class="table table-striped"></table>
    `);

    window.transactionsTable = new DataTableManager({
        api: link + '/api/v1/user/transactions/',
        tableSelector: '#transactions_table',
        filterSelector: '#transactions_filter',
        tableSearch: false,
        lengthMenu: [[20, 50, 100], [20, 50, 100]],
        order: [[0, 'desc']]
    });
}

function updateRknBadge() {
    $.ajax({
        url: link + '/api/v1/publisher/rkn-blocks',
        type: 'GET',
        headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        success: function (response) {
            if (response.success) {
                const data = response.data || [];
                const blockedCount = data.filter(item => item.status === 'blocked').length;

                if (blockedCount > 0) {
                    $('#rkn-count').text(blockedCount).show();
                } else {
                    $('#rkn-count').hide();
                }
            }
        },
        error: function () {
            $('#rkn-count').hide();
        }
    });
}

function showDataInModal(encodedRow) {
    const decodedRow = decodeURIComponent(encodedRow);
    const row = JSON.parse(decodedRow);
    if (row.info) {
        delete row.info;
    }
    $('#modal-content').text(JSON.stringify(row, null, 2));
    bootstrap.Modal.getOrCreateInstance('#dataModal').show();
}

function showGlobalToast(message = 'Уведомление', type = 'success') {
    const toast = document.getElementById('global-toast');
    const text = document.getElementById('global-toast-text');

    const types = {
        success: {bg: '#d1e7dd', color: '#0f5132', border: '#badbcc'},
        error: {bg: '#f8d7da', color: '#842029', border: '#f5c2c7'},
        info: {bg: '#cff4fc', color: '#055160', border: '#b6effb'},
    };

    const style = types[type] || types.success;
    toast.style.backgroundColor = style.bg;
    toast.style.color = style.color;
    toast.style.border = `1px solid ${style.border}`;
    text.textContent = message;

    toast.style.pointerEvents = 'auto';
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        toast.style.pointerEvents = 'none';
    }, 3000);
}

function updatePublisherId() {
    $.ajax({
        beforeSend: function (xhr) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
        },
        url: '/api/v1/get_id',
        type: 'GET',
        success: function (response) {
            const publisherId = response.data.id;

            if (publisherId) {

                $('.publisher-id-placeholder').each(function () {
                    $(this).text(publisherId);
                });

                $('code').each(function () {
                    let html = $(this).html();
                    if (html.includes('PUBLISHER_ID')) {
                        $(this).html(html.replace(/PUBLISHER_ID/g, publisherId));
                    }
                });

                console.log('Обновлено Publisher ID на:', publisherId);
            } else {
                console.error('Publisher ID не получен');
            }
        },
        error: function (xhr, status, error) {
            console.error('Ошибка при получении Publisher ID:', error);
            console.error('Статус:', status);
            console.error('Ответ сервера:', xhr.responseText);
        }
    });
}

function setPublisherId() {
    $.ajax({
        beforeSend: function (xhr) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
        },
        url: '/api/v1/get_id',
        type: 'GET',
        success: function (response) {
            const publisherId = response.data.id;

            function updateCodeSnippets(id) {
                $('code').each(function () {
                    let html = $(this).html();
                    let updated = false;

                    if (html.includes('id="vibix_union"') && !html.includes('data-publisher_id=')) {
                        html = html.replace(
                            'id="vibix_union"',
                            'id="vibix_union" data-publisher_id="' + id + '"'
                        );
                        updated = true;
                    }

                    if (html.includes('/embed')) {
                        html = html.replace(
                            /https:\/\/([^\.]+)\.([^\/]+)\/embed/g,
                            'https://' + id + '.$2/embed'
                        );
                        updated = true;
                    }

                    if (html.includes('674953133')) {
                        html = html.replace(/674953133/g, id);
                        updated = true;
                    }

                    if (updated) {
                        $(this).html(html);
                    }
                });
            }

            if (publisherId) {
                updateCodeSnippets(publisherId);
            } else {
                console.error('Publisher ID не получен');
            }
        },
        error: function (xhr, status, error) {
            console.error('Ошибка при получении Publisher ID:', error);
            console.error('Статус:', status);
            console.error('Ответ сервера:', xhr.responseText);
        }
    });
}

function initMaintenanceBlock() {
    $.ajax({
        beforeSend: function (xhr, settings) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'))
        },
        type: "GET",
        crossDomain: true,
        url: link + '/api/v1/maintenance/status',
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        success: function (data) {
            if (data.data && data.data.enabled) {
                showMaintenanceBlock(data.data);
            }
        },
        error: function (errMsg) {
        }
    });
}

function showMaintenanceBlock(maintenanceData) {
    const maintenanceHTML = `
        <div id="maintenanceBlockModal" class="modal fade show" style="display: block; background: rgba(0,0,0,0.8);" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content" style="border: none; box-shadow: 0 0 30px rgba(0,0,0,0.5);">
                    <div class="modal-body text-center p-5">
                        <div class="mb-4">
                            <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512" fill="#6c757d">
                                <path d="M195.1 9.5C198.1-5.3 211.2-16 226.4-16l59.8 0c15.2 0 28.3 10.7 31.3 25.5L332 79.5c14.1 6 27.3 13.7 39.3 22.8l67.8-22.5c14.4-4.8 30.2 1.2 37.8 14.4l29.9 51.8c7.6 13.2 4.9 29.8-6.5 39.9L447 233.3c.9 7.4 1.3 15 1.3 22.7s-.5 15.3-1.3 22.7l53.4 47.5c11.4 10.1 14 26.8 6.5 39.9l-29.9 51.8c-7.6 13.1-23.4 19.2-37.8 14.4l-67.8-22.5c-12.1 9.1-25.3 16.7-39.3 22.8l-14.4 69.9c-3.1 14.9-16.2 25.5-31.3 25.5l-59.8 0c-15.2 0-28.3-10.7-31.3-25.5l-14.4-69.9c-14.1-6-27.2-13.7-39.3-22.8L73.5 432.3c-14.4 4.8-30.2-1.2-37.8-14.4L5.8 366.1c-7.6-13.2-4.9-29.8 6.5-39.9l53.4-47.5c-.9-7.4-1.3-15-1.3-22.7s.5-15.3 1.3-22.7L12.3 185.8c-11.4-10.1-14-26.8-6.5-39.9L35.7 94.1c7.6-13.2 23.4-19.2 37.8-14.4l67.8 22.5c12.1-9.1 25.3-16.7 39.3-22.8L195.1 9.5zM256.3 336a80 80 0 1 0 -.6-160 80 80 0 1 0 .6 160z"/>
                            </svg>
                        </div>
                        
                        <h3 class="mb-3" style="color: #495057; font-weight: 600;">
                            ${maintenanceData.title || __("maintenance.title")}
                        </h3>
                        
                        <p class="mb-4" style="color: #6c757d; font-size: 16px; line-height: 1.5;">
                            ${maintenanceData.message || __("maintenance.default_message")}
                        </p>
                        
                        ${maintenanceData.scheduled_end ? `
                            <div class="mb-4">
                                ${__("maintenance.scheduled_end")}<br>
                                ${new Date(maintenanceData.scheduled_end).toLocaleString('ru-RU')}
                            </div>
                        ` : ''}
                        
                        <button id="refreshPageBtn" class="button" style="padding: 12px 30px; font-size: 16px;" data-i18n="maintenance.refresh_button">
                             Обновить страницу
                        </button>
                        
                        <div class="mt-3" style="color: #6c757d; font-size: 14px;">
                            ${__("maintenance.auto_refresh")} <span id="countdownTimer">60</span> ${__("maintenance.seconds")}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(maintenanceHTML);

    $('body').css('overflow', 'hidden');

    $('#refreshPageBtn').click(function () {
        location.reload();
    });

    startAutoRefreshCountdown();
}

function startAutoRefreshCountdown() {
    let seconds = 60;
    const countdownElement = $('#countdownTimer');
    const countdownInterval = setInterval(function () {
        seconds--;
        countdownElement.text(seconds);

        if (seconds <= 0) {
            clearInterval(countdownInterval);
            location.reload();
        }
    }, 1000);
}


$(document).ready(function () {
    setInterval(initMaintenanceBlock, 60000);
    initLanguage().then(() => {
        locationHashChanged();
    });
    window.onhashchange = locationHashChanged;
    $(document).on('click', '#csv-export', () => DataTableManager.exportCurrentTable());
    $(document).on('click', '#stats-reload', () => DataTableManager.reloadCurrentTable());
    initLanguage();
});

function loadTrialStatus() {
    $.ajax({
        url: link + '/api/v1/trial/status',
        method: 'GET',
        beforeSend: function (xhr, settings) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('token'));
        },
        success: function (response) {
            const data = response.data || {};
            const status = data.trial_status || 'without';

            const $trialBlock = $('.aside-block.mt-auto .card.trial-status-card');

            if (status === 'active') {
                $trialBlock.addClass('show').removeClass('d-none');

                $('#trial-header').removeClass('d-none');
                $('#trial-info-section').removeClass('d-none');

                $('#trial-status-indicator').removeClass().addClass('bg-success rounded-circle me-2');
                $('#trial-status-text').removeClass().addClass('badge bg-success bg-opacity-10 text-success').text(__("trial_status.active_until"));

                $('#trial-progress-section').removeClass('d-none');

                if (data.end_trial_at) {
                    $('#trial-end-date').text(data.end_trial_at).removeClass('d-none');
                }

                const daysLeft = data.trial_day_left || 0;
                const totalDays = data.trials_days_total || 30;
                const progressPercent = Math.round(((totalDays - daysLeft) / totalDays) * 100);
                $('#trial-progress-percent').text(progressPercent + '%');
                $('#trial-progress-bar').css({
                    'width': progressPercent + '%',
                    'background-color': '#28a745'
                });

                const link = '<a href="https://t.me/vibix_tv" target="_blank" class="text-decoration-underline"><small>' + __("trial_status.support_link") + '</small></a>';
                $('#trial-activation-text').html(__("trial_status.extend_info") + ' ' + link);
            } else {
                $trialBlock.removeClass('show').addClass('d-none');

                $('#trial-progress-section').addClass('d-none');
                $('#trial-end-date').addClass('d-none');
            }
        },
        error: function () {
            $('.aside-block.mt-auto .card.trial-status-card').removeClass('show').addClass('d-none');
        }
    });
}

function getColorParams(design) {
    const storageKey = `player_design_${design}_colors`;
    let colors = {};

    try {
        colors = JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (e) {
    }

    const params = [];

    for (let i = 1; i <= 5; i++) {
        const colorKey = `color${i}`;
        const colorValue = colors[colorKey];
        const defaultColors = {
            1: {
                color1: '#56ceaa',
                color2: '#ffffff',
                color3: '#aec7bc',
                color4: '#42bd88',
                color5: '#000000'
            },
            2: {
                color1: '#333333',
                color2: '#666666',
                color3: '#999999',
                color4: '#CCCCCC',
                color5: '#FFFFFF'
            },
            3: {
                color1: '#0066FF',
                color2: '#00FFFF',
                color3: '#000033',
                color4: '#0099FF',
                color5: '#CCFFFF'
            },
            4: {
                color1: '#FF0000',
                color2: '#CC0000',
                color3: '#282828',
                color4: '#FF3333',
                color5: '#FFFFFF'
            },
            5: {
                color1: '#111111',
                color2: '#fbfbfb',
                color3: '#111111',
                color4: '#121111',
                color5: '#CCCCCC'
            },
            6: {
                color1: '#56ceaa',
                color2: '#ffffff',
                color3: '#aec7bc',
                color4: '#42bd88',
                color5: '#000000'
            },
        };

        const finalColor = colorValue || defaultColors[design]?.[colorKey] || '';

        if (finalColor) {
            params.push(`data-color${i}="${finalColor}"`);
        }
    }

    return params.length > 0 ? ' ' + params.join(' ') : '';
}

function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}

let currentLocale = 'ru';
let translations = {};

async function loadTranslations(locale) {
    try {
        const response = await fetch(`/static/locales/${locale}.json?v=46`);
        if (!response.ok) throw new Error('Translation file not found');
        translations = await response.json();
        currentLocale = locale;
        localStorage.setItem('app_lang', locale);
        document.documentElement.lang = locale === 'ru' ? 'ru' : 'en';
        return true;
    } catch (error) {
        console.error('Failed to load translations:', error);
        return false;
    }
}

function __(key, params = {}) {
    const keys = key.split('.');
    let text = translations;

    for (let i = 0; i < keys.length; i++) {
        if (text && typeof text === 'object') {
            text = text[keys[i]];
        } else {
            text = undefined;
            break;
        }
    }

    if (text === undefined || text === null) {
        return key;
    }

    Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`:${param}`, 'g'), params[param]);
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
    });

    return text;
}

function applyTranslationsToPage() {
    $('[data-i18n]').each(function () {
        const key = $(this).data('i18n');
        const translatedText = __(key);
        const $el = $(this);

        if ($el.is('input, textarea')) {
            if ($el.attr('placeholder')) {
                $el.attr('placeholder', translatedText);
            }
        } else {
            if ($el.html() !== translatedText && translatedText !== key) {
                $el.html(translatedText);
            }
        }
    });

    $('[data-i18n-placeholder]').each(function () {
        const key = $(this).data('i18n-placeholder');
        const translatedText = __(key);
        $(this).attr('placeholder', translatedText);
    });

    $('[data-i18n-title]').each(function () {
        $(this).attr('title', __($(this).data('i18n-title')));
    });

    $('[data-i18n-alt]').each(function () {
        $(this).attr('alt', __($(this).data('i18n-alt')));
    });
}

async function switchLanguage(locale) {
    if (locale === currentLocale) return;

    localStorage.setItem('app_lang', locale);
    location.reload();
}

async function initLanguage() {
    const savedLang = localStorage.getItem('app_lang') || 'ru';
    await loadTranslations(savedLang);
    applyTranslationsToPage();

    $(`.lang-btn[data-lang="${savedLang}"]`).addClass('active');

    $(document).on('click', '.lang-btn', function () {
        const newLang = $(this).data('lang');
        switchLanguage(newLang);
    });
}