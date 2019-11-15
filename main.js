const Apify = require('apify');
const url = require('url');
const _ = require('underscore');
const safeEval = require('safe-eval');

const { log } = Apify.utils;
log.setLevel(log.LEVELS.WARNING);

function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

function strMapToObj(strMap) {
    let obj = Object.create(null);
    for (let [k,v] of strMap) {
      obj[k] = v;
    }
    return obj;
  }

function objToStrMap(obj) {
    let strMap = new Map();
    for (let k of Object.keys(obj)) {
      strMap.set(k, obj[k]);
    }
    return strMap;
}

const isObject = val => typeof val === 'object' && val !== null && !Array.isArray(val);

let detailsEnqueued = 0;

Apify.events.on('migrating', async () => {
    await Apify.setValue('detailsEnqueued', detailsEnqueued);
});

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.dir(input);

    if (!input || !Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunction;
    if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunction = safeEval(input.extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const requestQueue = await Apify.openRequestQueue();

    detailsEnqueued = await Apify.getValue('detailsEnqueued');
    if (!detailsEnqueued) {
        detailsEnqueued = 0;
    }

    function checkLimit() {
        return input.maxItems && detailsEnqueued >= input.maxItems;
    }

    for (const item of input.startUrls) {
        const startUrl = item.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes('https://www.bloomingdales.com/')) {
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
        maxRequestRetries: 1,
        handlePageTimeoutSecs: 60,

        handlePageFunction: async ({ request, $ }) => {
            await delay(1000);
            console.log(`Processing ${request.url}...`);

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

                    const href = 'https://www.bloomingdales.com' + $(itemLinks[index]).attr('href');

                    await requestQueue.addRequest({ url: `${href}`, userData: { label: 'item' } },
                        { forefront: true });
                }

                const arr = paginationEle.text().split('of');
                const perPage = arr[0].trim().split('-')[1];
                const pageCount = Math.floor(parseInt(arr[1].trim().split(' ')[0], 10) / perPage); // Each page has 96 items

                if (pageCount > 0) {
                    const nextIndex = 2;
                    const {protocol, host, pathname, search} = url.parse(request.url);

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

                    await requestQueue.addRequest({ url: startUrl, userData: { label: 'list', origin: originUrl, total: pageCount + 1, params: paramsObj } });
                }
            } else if (request.userData.label === 'list') {
                const itemLinks = $('a.productDescLink');
                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = 'https://www.bloomingdales.com' + $(itemLinks[index]).attr('href');

                    await requestQueue.addRequest({ url: `${href}`, userData: { label: 'item' } },
                        { forefront: true });
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
                    const {search} = url.parse(request.url);
                    const startUrl = `${originUrl}/${keys}/${values}${search}`;

                    await requestQueue.addRequest({ url: startUrl, userData: { label: 'list', origin: originUrl, total: pageCount, params: paramsObj } });
                }
            } else if (request.userData.label === 'item') {
                // <script data-bootstrap="page/product" type="application/json"></script>
                const json = JSON.parse($('script[data-bootstrap="page/product"]').text());
                const itemId = json.product.id;
                const name = $('.product-title h1').text().trim();
                const color = $('.color-display-name').text();
                const sizes = $('.size-dropdown option').map(o => $(o).text()).toArray();
                const price = $('.final-price').text().trim();

                const pageResult = {
                    url: request.url,
                    name,
                    itemId,
                    color,
                    sizes,
                    price,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                };

                if (extendOutputFunction) {
                    const userResult = await extendOutputFunction($);

                    if (!isObject(userResult)) {
                        console.log('extendOutputFunction has to return an object!!!');
                        process.exit(1);
                    }

                    _.extend(pageResult, userResult);
                }

                await Apify.pushData(pageResult);
            }
        },

        // This function is called if the page processing failed more than maxRequestRetries+1 times.
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed twice.`);
        },

        ...input.proxyConfiguration,
    });

    // Run the crawler and wait for it to finish.
    await crawler.run();

    console.log('Crawler finished.');
});
