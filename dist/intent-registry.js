export function defineIntentRegistry(spec) {
    return deepFreeze(spec);
}
function deepFreeze(value) {
    if (!isRecord(value) && !Array.isArray(value)) {
        return value;
    }
    Object.freeze(value);
    for (const nestedValue of Object.values(value)) {
        if ((isRecord(nestedValue) || Array.isArray(nestedValue)) &&
            !Object.isFrozen(nestedValue)) {
            deepFreeze(nestedValue);
        }
    }
    return value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
