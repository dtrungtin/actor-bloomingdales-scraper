### Bloomingdales Scraper

Bloomingdales Scraper is an [Apify actor](https://apify.com/actors) for extracting data about actors from [Bloomingdales](https://www.bloomingdales.com/). It allows you to extract all products. It is build on top of [Apify SDK](https://sdk.apify.com/) and you can run it both on [Apify platform](https://my.apify.com) and locally.

- [Input](#input)
- [Output](#output)
- [Compute units consumption](#compute-units-consumption)
- [Extend output function](#extend-output-function)

### Input

| Field | Type | Description | Default value
| ----- | ---- | ----------- | -------------|
| startUrls | array | List of [Request](https://sdk.apify.com/docs/api/request#docsNav) objects that will be deeply crawled. The URL can be home page like `https://www.bloomingdales.com/` or category page `https://www.bloomingdales.com/shop/makeup-perfume-beauty/luxury-lip-balm?id=1005921` or detail page `https://www.bloomingdales.com/shop/product/laura-mercier-lip-balm-spf-15?ID=519181&CategoryID=1005921`. | `[{ "url": "https://www.bloomingdales.com/" }]`|
| maxItems | number | Maximum number of actor pages that will be scraped | all found |
| extendOutputFunction | string | Function that takes a Cheerio handle ($) as argument and returns data that will be merged with the result output. More information in [Extend output function](#extend-output-function) | |
| proxyConfiguration | object | Proxy settings of the run. This actor works better with the Apify proxy group SHADER. If you have access to this Apify proxy group, leave the default settings. If not, you can use other Apify proxy groups or you can set `{ "useApifyProxy": false" }` to disable proxy usage | `{ "useApifyProxy": true, "apifyProxyGroups": ["SHADER"] }`|

### Output

Output is stored in a dataset. Each item is an information about a product. Example:

```
{
  "url": "https://www.bloomingdales.com/shop/product/burberry-lightweight-giant-check-wool-silk-scarf?ID=3611219&CategoryID=3376",
  "categories": [
    "Jewelry & Accessories"
  ],
  "scrapedAt": "2019-11-28T03:26:00.887Z",
  "title": "Lightweight Giant Check Wool & Silk Scarf",
  "description": "Burberry's oblong scarf offers lightweight luxe with its sheer, gauzy fabrication.",
  "designer": null,
  "itemId": "3611219",
  "color": "Limestone",
  "price": 390,
  "salePrice": 234,
  "currency": "USD",
  "source": "www.bloomingdales.com",
  "brand": "Burberry",
  "images": [
    {
      "src": "https://images.bloomingdalesassets.com/is/image/BLM/products/9/optimized/10295289_fpx.tif"
    },
    {
      "src": "https://images.bloomingdalesassets.com/is/image/BLM/products/0/optimized/10295290_fpx.tif"
    }
  ],
  "composition": [
    "Wool/silk"
  ],
  "sizes": [],
  "availableSizes": []
}
```

### Compute units consumption
Keep in mind that it is much more efficient to run one longer scrape (at least one minute) than more shorter ones because of the startup time.

The average consumption is **0.2 Compute unit for 1000 actor pages** scraped

### Extend output function

You can use this function to update the result output of this actor. This function gets a Cheerio handle `$` as an argument so you can choose what data from the page you want to scrape. The output from this will function will get merged with the result output.

The return value of this function has to be an object!

You can return fields to achive 3 different things:
- Add a new field - Return object with a field that is not in the result output
- Change a field - Return an existing field with a new value
- Remove a field - Return an existing field with a value `undefined`


```
($) => {
    return {
        "saleEnd": $('.sale-ends span').text().trim(),
        "salePrice": 0,
        url: undefined
    }
}
```
This example will add a new field `saleEnd`, change the `salePrice` field and remove `url` field
```
{
  "saleEnd": "Sale Ends 11/30/19",      
  "categories": [
    "Jewelry & Accessories"
  ],
  "scrapedAt": "2019-11-28T03:26:00.887Z",
  "title": "Lightweight Giant Check Wool & Silk Scarf",
  "description": "Burberry's oblong scarf offers lightweight luxe with its sheer, gauzy fabrication.",
  "designer": null,
  "itemId": "3611219",
  "color": "Limestone",
  "price": 390,
  "salePrice": 0,
  "currency": "USD",
  "source": "www.bloomingdales.com",
  "brand": "Burberry",
  "images": [
    {
      "src": "https://images.bloomingdalesassets.com/is/image/BLM/products/9/optimized/10295289_fpx.tif"
    },
    {
      "src": "https://images.bloomingdalesassets.com/is/image/BLM/products/0/optimized/10295290_fpx.tif"
    }
  ],
  "composition": [
    "Wool/silk"
  ],
  "sizes": [],
  "availableSizes": []
}
```

### Epilogue
Thank you for trying my actor. I will be very glad for a feedback that you can send to my email `dtrungtin@gmail.com`. If you find any bug, please create an issue on the [Github page](https://github.com/dtrungtin/actor-bloomingdales-scraper).