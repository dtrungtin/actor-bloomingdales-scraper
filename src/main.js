const Apify = require('apify');
const url = require('url');
const querystring = require('querystring');

const { extractData } = require('./extract');
const { delay, strMapToObj, objToStrMap, isObject } = require('./utils');

const { log } = Apify.utils;

let detailsEnqueued = 0;

Apify.events.on('migrating', async () => {
    await Apify.setValue('detailsEnqueued', detailsEnqueued);
});

const WEBSITE = 'https://www.bloomingdales.com';

Apify.main(async () => {
    const input = await Apify.getInput();
    log.info('Input:', input);

    const { startUrls, maxItems, extendOutputFunction, proxyConfig } = input;

    if (!input || !Array.isArray(startUrls) || startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunctionObj;
    if (typeof extendOutputFunction === 'string' && extendOutputFunction.trim() !== '') {
        try {
            // eslint-disable-next-line no-eval
            extendOutputFunctionObj = eval(extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunctionObj !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const defaultProxyConfig = {
        useApifyProxy: true,
    };

    const proxyConfiguration = await Apify.createProxyConfiguration(proxyConfig || defaultProxyConfig);

    if (!proxyConfiguration || (!proxyConfiguration.usesApifyProxy && (!proxyConfiguration.proxyUrls
        || !proxyConfiguration.proxyUrls.length)) || !proxyConfiguration.newUrl()) {
        throw new Error('\n=======\nYou must use Apify proxy or custom proxy URLs\n\n=======');
    }

    const requestQueue = await Apify.openRequestQueue();

    detailsEnqueued = await Apify.getValue('detailsEnqueued');
    if (!detailsEnqueued) {
        detailsEnqueued = 0;
    }

    function checkLimit() {
        return maxItems && detailsEnqueued >= maxItems;
    }

    for (const item of startUrls) {
        let startUrl = item.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes('bloomingdales.com')) {
            if (!startUrl.includes('www.bloomingdales.com')) {
                startUrl = startUrl.replace('bloomingdales.com', 'www.bloomingdales.com');
            }

            if (startUrl.includes('/product/')) {
                const params = querystring.parse(startUrl.split('?')[1]);
                const itemId = params.ID;
                const { wasAlreadyPresent, wasAlreadyHandled } = await requestQueue.addRequest(
                    { url: startUrl, uniqueKey: itemId, userData: { label: 'item' } },
                    { forefront: true },
                );
                if (!wasAlreadyPresent && !wasAlreadyHandled) {
                    detailsEnqueued++;
                }
            } else if (startUrl.includes('/shop/') || startUrl.includes('/buy/')) {
                const { pathname } = url.parse(startUrl);
                const parts = pathname.split('/');

                if (parts.length === 3 && startUrl.includes('/shop/') && !startUrl.includes('/search')) {
                    await requestQueue.addRequest({ url: startUrl, userData: { label: 'topshop' } });
                } else {
                    await requestQueue.addRequest({ url: startUrl, userData: { label: 'shop' } });
                }
            } else {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'home' } });
            }
        }
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        maxConcurrency: 50,
        maxRequestRetries: 3,
        handlePageTimeoutSecs: 1800,
        proxyConfiguration,
        useSessionPool: true,

        handlePageFunction: async ({ request, body, $ }) => {
            log.info(`Processing ${request.url}...`);

            if (body.includes('Access Denied')) {
                throw new Error('We got blocked, to ensure stable run, please use SHADER or RESIDENTIAL proxy group');
            }

            if (request.userData.label === 'home') {
                if (checkLimit()) {
                    return;
                }

                const allCategoryLinks = $('a.leftnav-item-link');
                if (allCategoryLinks.length === 0) {
                    await Apify.setValue('home_html', body, { contentType: 'text/html' });
                    throw new Error('Something wrong! Retrying...');
                }

                for (let index = 0; index < allCategoryLinks.length; index++) {
                    if (checkLimit()) {
                        return;
                    }

                    const href = `${WEBSITE}${$(allCategoryLinks[index]).attr('href')}`;
                    const { pathname } = url.parse(href);
                    const parts = pathname.split('/');

                    if (href.includes('/shop/') || href.includes('/buy/')) {
                        if (href.includes('/shop/') && parts.length === 3) {
                            await requestQueue.addRequest({ url: href, userData: { label: 'topshop' } });
                        } else {
                            await requestQueue.addRequest({ url: href, userData: { label: 'shop' } });
                        }
                    }
                    await delay(5000);
                }
            } else if (request.userData.label === 'topshop') {
                if (checkLimit()) {
                    return;
                }

                const categoryLinks = $('.adCatIcon a');
                for (let index = 0; index < categoryLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = `${WEBSITE}${$(categoryLinks[index]).attr('href')}`;
                    await requestQueue.addRequest({ url: href, userData: { label: 'shop' } });
                    await delay(5000);
                }
            } else if (request.userData.label === 'shop') {
                if (checkLimit()) {
                    return;
                }

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
                    const params = querystring.parse(href.split('?')[1]);
                    const itemId = params.ID;

                    const { wasAlreadyPresent, wasAlreadyHandled } = await requestQueue.addRequest(
                        { url: `${href}`, uniqueKey: itemId, userData: { label: 'item' } },
                        { forefront: true },
                    );
                    if (!wasAlreadyPresent && !wasAlreadyHandled) {
                        detailsEnqueued++;
                    }
                }

                if (checkLimit()) {
                    return;
                }

                const arr = paginationEle.text().split('of');
                const perPage = arr[0].trim().split('-')[1];
                const pageCount = Math.floor(parseInt(arr[1].trim().split(' ')[0].split(',').join(''), 10) / perPage);

                if (pageCount > 0) {
                    const nextIndex = 2;
                    const { protocol, host, pathname, search } = url.parse(request.url);
                    const parts = pathname.split('/');
                    let originalPathname = '';
                    const params = new Map();

                    // "/shop/search/Pageindex/2?keyword=shirt"
                    if (request.url.includes('/search/')) {
                        originalPathname = parts.slice(0, 3).join('/');
                        if (parts.length > 3) {
                            const paramNames = parts[3].split(',');
                            const paramValues = parts[4].split(',');

                            for (let index = 0; index < paramNames.length; index++) {
                                const pName = paramNames[index];
                                const pValue = paramValues[index];
                                params.set(pName, pValue);
                            }
                        }
                    // "/shop/jewelry-accessories/designer-bracelets/Bracelets_type,Pageindex/Bangle,2"
                    } else {
                        originalPathname = parts.slice(0, 4).join('/');
                        if (parts.length > 4) {
                            const paramNames = parts[4].split(',');
                            const paramValues = parts[5].split(',');

                            for (let index = 0; index < paramNames.length; index++) {
                                const pName = paramNames[index];
                                const pValue = paramValues[index];
                                params.set(pName, pValue);
                            }
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
                if (checkLimit()) {
                    return;
                }

                const itemLinks = $('a.productDescLink');
                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = `${WEBSITE}${$(itemLinks[index]).attr('href')}`;
                    const params = querystring.parse(href.split('?')[1]);
                    const itemId = params.ID;

                    const { wasAlreadyPresent, wasAlreadyHandled } = await requestQueue.addRequest(
                        { url: `${href}`, uniqueKey: itemId, userData: { label: 'item' } }, { forefront: true },
                    );
                    if (!wasAlreadyPresent && !wasAlreadyHandled) {
                        detailsEnqueued++;
                    }
                }

                if (checkLimit()) {
                    return;
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
                const pageResults = extractData(request, body, $);
                let userResult;

                if (extendOutputFunction) {
                    userResult = await extendOutputFunctionObj($);

                    if (!isObject(userResult)) {
                        log.error('extendOutputFunction has to return an object!!!');
                        process.exit(1);
                    }
                }

                for (let pageResult of pageResults) {
                    if (userResult) {
                        pageResult = Object.assign(pageResult, userResult);
                    }
                    await Apify.pushData(pageResult);
                }
            }
        },

        // This function is called if the page processing failed more than maxRequestRetries+1 times.
        handleFailedRequestFunction: async ({ request }) => {
            log.info(`Request ${request.url} failed many times.`);
        },
    });

    // Run the crawler and wait for it to finish.
    await crawler.run();

    log.info('Crawler finished.');
});
