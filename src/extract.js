const Apify = require('apify');
const querystring = require('querystring');

function extractData(request, html, $) {
    // <script data-bootstrap="page/product" type="application/json"></script>
    const scriptData = $('script[data-bootstrap="page/product"]').text();
    const json = JSON.parse(scriptData);
    const params = querystring.parse(request.url.split('?')[1]);
    const itemId = params.ID;
    const { title, description, bulletText } = json.product.detail;
    let fullDescription = description;
    if (bulletText) {
        fullDescription += ` ${bulletText.map(Function.prototype.call, String.prototype.trim).join('. ')}`;
    }
    const currency = $('.links-rail-currency').text().trim();
    // eslint-disable-next-line camelcase
    const { product_original_price, product_price } = json.utagData;
    const price = parseFloat(product_original_price[0]);
    const salePrice = parseFloat(product_price[0]);

    const source = 'www.bloomingdales.com';
    const brand = json.product.detail.brand.name;
    const matertials = json.product.detail.materialsAndCare ? json.product.detail.materialsAndCare[0].split(';')
        .map(Function.prototype.call, String.prototype.trim) : [];

    const sizeMap = json.product.traits.sizes ? json.product.traits.sizes.sizeMap : {};
    const { colorMap } = json.product.traits.colors;
    const results = [];
    const now = new Date();

    const { categories } = json.product.relationships.taxonomy;
    const categoryList = categories ? categories.filter(cat => !!cat.id).map(cat => cat.name.trim()) : [];

    for (const colorObj of Object.values(colorMap)) {
        const color = colorObj.name;
        const { images } = colorObj.imagery;
        const imageList = [];
        const imageUrl = json.product.urlTemplate.product;
        for (const image of Object.values(images)) {
            imageList.push({
                src: imageUrl + image.filePath,
            });
        }

        const result = {
            url: request.url,
            categories: categoryList,
            scrapedAt: now.toISOString(),
            title,
            description: fullDescription.trim(),
            designer: null,
            itemId,
            color,
            price,
            salePrice,
            currency,
            source,
            brand,
            images: imageList,
            composition: matertials,
            '#debug': Apify.utils.createRequestDebugInfo(request),
        };

        const sizes = [];
        const availableSizes = [];
        if (colorObj.sizes) {
            for (const sizeId of colorObj.sizes) {
                const sizeObj = sizeMap[sizeId];
                const sizeDisplayName = sizeObj.displayName;
                sizes.push(sizeDisplayName);
                availableSizes.push(sizeDisplayName);
            }
        }

        result.sizes = sizes;
        result.availableSizes = availableSizes;
        results.push(result);
    }

    return results;
}

module.exports = {
    extractData,
};
