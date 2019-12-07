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

module.exports = {
    delay,
    strMapToObj,
    objToStrMap,
    isObject,
};
