import { createApp, server, serving } from '@databricks/appkit';
import { registerCatalogRoutes } from './routes/catalog';
import { registerProfilingRoutes } from './routes/profiling';
import { registerMetadataRoutes } from './routes/metadata';
import { registerApplyRoutes } from './routes/apply';
import { registerGenieRoutes } from './routes/genie';

createApp({
  plugins: [server(), serving()],
  async onPluginsReady(appkit) {
    registerCatalogRoutes(appkit);
    registerProfilingRoutes(appkit);
    registerMetadataRoutes(appkit);
    registerApplyRoutes(appkit);
    registerGenieRoutes(appkit);
  },
}).catch(console.error);
