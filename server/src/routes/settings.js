import { createKeyedResource } from '../keyedRouter.js';
import { sanitizeSetting, isAllowedSetting } from '../sanitizers/index.js';

export default createKeyedResource({
    table: 'settings',
    keyColumn: 'key',
    keyField: 'key',
    columns: { key: 'key', value: 'value' },
    sanitize: (body, key) => {
        const clean = sanitizeSetting({ key, value: body?.value });
        // #569: only keys/values the app itself writes (settingsSchema.js).
        return clean && isAllowedSetting(clean.key, clean.value) ? { key: clean.key, value: JSON.stringify(clean.value) } : null;
    }
});
