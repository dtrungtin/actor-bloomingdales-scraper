const Apify = require('apify');
const url = require('url');
const safeEval = require('safe-eval');

const { log } = Apify.utils;
log.setLevel(log.LEVELS.DEBUG);

function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

function strMapToObj(strMap) {
    const obj = Object.create(null);
    for (const [k, v] of strMap) {
        obj[k] = v;
    }
    return obj;
}

function objToStrMap(obj) {
    const strMap = new Map();
    for (const k of Object.keys(obj)) {
        strMap.set(k, obj[k]);
    }
    return strMap;
}

const isObject = val => typeof val === 'object' && val !== null && !Array.isArray(val);

function extractData(request, $) {
    // <script data-bootstrap="page/product" type="application/json"></script>
    const scriptData = $('script[data-bootstrap="page/product"]').text();
    log.debug('Script data: ', scriptData);
    const json = JSON.parse(scriptData);
    const itemId = json.product.id;
    const name = $('.product-title h1').text().trim();
    const color = $('.color-display-name').text();
    const sizes = [];
    $('.size-dropdown').find('option').each((i, op) => {
        if (i > 0) {
            sizes.push($(op).text().trim());
        }
    });
    const price = $('.final-price').text().trim();

    return {
        url: request.url,
        name,
        itemId,
        color,
        sizes,
        price,
        '#debug': Apify.utils.createRequestDebugInfo(request),
    };
}

let detailsEnqueued = 0;

Apify.events.on('migrating', async () => {
    await Apify.setValue('detailsEnqueued', detailsEnqueued);
});

const WEBSITE = 'https://www.bloomingdales.com';

Apify.main(async () => {
    const input = await Apify.getInput();
    log.info('Input:', input);

    const { startUrls, maxItems, extendOutputFunction, proxyConfiguration } = input;

    if (!input || !Array.isArray(startUrls) || startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunctionObj;
    if (typeof extendOutputFunction === 'string' && extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunctionObj = safeEval(extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunctionObj !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    let proxyConf = {
        useApifyProxy: true,
    };

    if (proxyConfiguration) proxyConf = proxyConfiguration;

    const requestQueue = await Apify.openRequestQueue();

    detailsEnqueued = await Apify.getValue('detailsEnqueued');
    if (!detailsEnqueued) {
        detailsEnqueued = 0;
    }

    function checkLimit() {
        return maxItems && detailsEnqueued >= maxItems;
    }

    for (const item of startUrls) {
        const startUrl = item.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes(WEBSITE)) {
            if (startUrl.includes('/product/')) {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'item' } });
                detailsEnqueued++;
            } else {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'start' } });
            }
        }
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        minConcurrency: 10,
        maxConcurrency: 50,
        maxRequestRetries: 2,
        handlePageTimeoutSecs: 60,

        handlePageFunction: async ({ request, $ }) => {
            await delay(1000);
            log.info(`Processing ${request.url}...`);

            if (request.userData.label === 'start') {
                // (1-96 of 727 Items)
                const paginationEle = $('.page-range');
                if (!paginationEle || paginationEle.text() === '') {
                    return;
                }

                const itemLinks = $('a.productDescLink');
                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = `${WEBSITE}${$(itemLinks[index]).attr('href')}`;

                    await requestQueue.addRequest({ url: `${href}`, userData: { label: 'item' } });
                    detailsEnqueued++;
                }

                const arr = paginationEle.text().split('of');
                const perPage = arr[0].trim().split('-')[1];
                const pageCount = Math.floor(parseInt(arr[1].trim().split(' ')[0], 10) / perPage); // Each page has 96 items

                if (pageCount > 0) {
                    const nextIndex = 2;
                    const { protocol, host, pathname, search } = url.parse(request.url);

                    // Ex: /shop/jewelry-accessories/designer-bracelets/Bracelets_type,Pageindex/Bangle,2
                    const parts = pathname.split('/');
                    const originalPathname = parts.slice(0, 4).join('/');
                    const params = new Map();

                    if (parts.length > 4) {
                        const paramNames = parts[4].split(',');
                        const paramValues = parts[5].split(',');

                        for (let index = 0; index < paramNames.length; index++) {
                            const pName = paramNames[index];
                            const pValue = paramValues[index];
                            params.set(pName, pValue);
                        }
                    }

                    params.set('Pageindex', nextIndex);
                    const keys = Array.from(params.keys()).join(',');
                    const values = Array.from(params.values()).join(',');
                    const originUrl = `${protocol}//${host}${originalPathname}`;
                    const startUrl = `${originUrl}/${keys}/${values}${search}`;
                    const paramsObj = strMapToObj(params);

                    await requestQueue.addRequest({ url: startUrl,
                        userData: { label: 'list', origin: originUrl, total: pageCount + 1, params: paramsObj } });
                }
            } else if (request.userData.label === 'list') {
                const itemLinks = $('a.productDescLink');
                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = `${WEBSITE}${$(itemLinks[index]).attr('href')}`;

                    await requestQueue.addRequest({ url: `${href}`, userData: { label: 'item' } });
                    detailsEnqueued++;
                }

                const pageCount = request.userData.total;
                const originUrl = request.userData.origin;
                const params = objToStrMap(request.userData.params);
                const index = params.get('Pageindex');
                const nextIndex = index + 1;
                params.set('Pageindex', nextIndex);
                const keys = Array.from(params.keys()).join(',');
                const values = Array.from(params.values()).join(',');
                const paramsObj = strMapToObj(params);

                if (index < pageCount) {
                    const { search } = url.parse(request.url);
                    const startUrl = `${originUrl}/${keys}/${values}${search}`;

                    await requestQueue.addRequest({ url: startUrl,
                        userData: { label: 'list', origin: originUrl, total: pageCount, params: paramsObj } });
                }
            } else if (request.userData.label === 'item') {
                let pageResult = extractData(request, $);

                if (extendOutputFunction) {
                    const userResult = await extendOutputFunctionObj($);

                    if (!isObject(userResult)) {
                        log.error('extendOutputFunction has to return an object!!!');
                        process.exit(1);
                    }

                    pageResult = Object.assign(pageResult, userResult);
                }

                await Apify.pushData(pageResult);
            }
        },

        // This function is called if the page processing failed more than maxRequestRetries+1 times.
        handleFailedRequestFunction: async ({ request }) => {
            log.info(`Request ${request.url} failed twice.`);
        },

        ...proxyConf,
    });

    // Run the crawler and wait for it to finish.
    await crawler.run();

    log.info('Crawler finished.');
});