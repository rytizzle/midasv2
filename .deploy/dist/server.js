import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerProfilingRoutes } from "./routes/profiling.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerApplyRoutes } from "./routes/apply.js";
import { registerGenieRoutes } from "./routes/genie.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { createApp, server, serving } from "@databricks/appkit";

//#region server/server.ts
createApp({
	plugins: [server(), serving()],
	async onPluginsReady(appkit) {
		registerCatalogRoutes(appkit);
		registerProfilingRoutes(appkit);
		registerMetadataRoutes(appkit);
		registerApplyRoutes(appkit);
		registerGenieRoutes(appkit);
		registerSessionRoutes(appkit);
	}
}).catch(console.error);

//#endregion
export {  };