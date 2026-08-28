import { createPersistence } from "./index"

const dataDirectory = process.env["DATA_DIR"]
if (dataDirectory === undefined) process.exitCode = 1
else createPersistence({ dataDirectory }).close()
