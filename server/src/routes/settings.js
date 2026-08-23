import { createKeyedResource } from '../keyedRouter.js';
import { sanitizeSetting } from '../sanitizers/index.js';

export default createKeyedResource({
    table: 'settings',
    keyColumn: 'key',
    keyField: 'key',
    columns: { key: 'key', value: 'value' },
    sanitize: (body, key) => {
        const clean = sanitizeSetting({ key, value: body?.value });
        return clean ? { key: clean.key, value: JSON.stringify(clean.value) } : null;
    }
});
