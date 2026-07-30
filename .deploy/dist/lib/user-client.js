import { WorkspaceClient } from "@databricks/sdk-experimental";

//#region server/lib/user-client.ts
/**
* Build an on-behalf-of-user WorkspaceClient from the Databricks Apps
* X-Forwarded-* headers. Falls back to default SDK auth if the user token
* is missing (e.g. when running outside the Apps runtime).
*/
function userWorkspaceClient(req) {
	const token = req.header("x-forwarded-access-token");
	const host = process.env.DATABRICKS_HOST || "";
	if (token && host) return new WorkspaceClient({
		host: host.startsWith("http") ? host : `https://${host}`,
		token,
		authType: "pat"
	});
	return new WorkspaceClient({});
}
function userInfo(req) {
	return {
		email: req.header("x-forwarded-email") || "",
		name: req.header("x-forwarded-preferred-username") || "",
		userId: req.header("x-forwarded-user") || "",
		token: req.header("x-forwarded-access-token") || "",
		host: req.header("x-forwarded-host") || ""
	};
}

//#endregion
export { userInfo, userWorkspaceClient };