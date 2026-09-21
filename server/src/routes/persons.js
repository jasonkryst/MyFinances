import { createCrudResource } from '../crudRouter.js';
import { sanitizePerson } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'persons',
    sanitize: sanitizePerson,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name'
    }
});
