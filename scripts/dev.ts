const serverPort = process.env["PORT"] ?? "3000"
const bindHost = process.env["BIND_HOST"] ?? "127.0.0.1"
const dataDirectory = process.env["DATA_DIR"] ?? "./data"
const clientPort = process.env["VITE_PORT"] ?? "5173"
const apiOrigin = `http://${bindHost}:${serverPort}`
const localHosts = new Set([
  ...(process.env["LOCAL_HOSTS"]?.split(",") ?? []),
  `${bindHost}:${serverPort}`,
  `localhost:${serverPort}`,
  `127.0.0.1:${serverPort}`
])

const environment = {
  ...process.env,
  PORT: serverPort,
  BIND_HOST: bindHost,
  DATA_DIR: dataDirectory,
  LOCAL_HOSTS: [...localHosts].join(","),
  VITE_PORT: clientPort,
  VITE_API_PROXY_TARGET: process.env["VITE_API_PROXY_TARGET"] ?? apiOrigin
}

const processes = [
  Bun.spawn(["bun", "server/src/index.ts"], {
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  }),
  Bun.spawn(["node", "../node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], {
    cwd: "client",
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  })
]

let stopping = false

const stop = (signal: NodeJS.Signals): void => {
  if (stopping) return
  stopping = true
  for (const process of processes) process.kill(signal)
}

process.once("SIGINT", () => stop("SIGINT"))
process.once("SIGTERM", () => stop("SIGTERM"))

console.info(`로컬 개발 환경을 시작합니다: http://${bindHost}:${clientPort}`)

await Promise.race(processes.map((child) => child.exited))
if (!stopping) stop("SIGTERM")
const exitCodes = await Promise.all(processes.map((child) => child.exited))
process.exitCode = exitCodes.find((code) => code !== 0) ?? 0
