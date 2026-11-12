// Wraps a record sanitizer so a failed validity check becomes a null result
// (crudRouter answers 400). On PATCH, crudRouter passes ctx with the fields
// the request actually sent. A request that touches none of the validity
// fields (`fields`) cannot change whether the record is valid, so it is let
// through: a legacy row stored before the rule existed must stay
// pausable/editable on unrelated fields.
export function validatedSanitizer(sanitize, isValid, fields) {
    return (body, idFallback, ctx) => {
        const clean = sanitize(body, idFallback);
        if (isValid(clean)) return clean;
        if (ctx && Array.isArray(ctx.patchedFields) && !ctx.patchedFields.some(f => fields.includes(f))) return clean;
        return null;
    };
}
