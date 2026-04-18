function isDebugEnabled() {
  return process.env.OMATRUST_DEBUG === "true";
}

function write(method: "debug" | "info" | "warn" | "error", message: string, data?: unknown) {
  if (method === "debug" && !isDebugEnabled()) {
    return;
  }

  if (data === undefined) {
    console[method](message);
    return;
  }

  console[method](message, data);
}

const logger = {
  debug(message: string, data?: unknown) {
    write("debug", message, data);
  },
  info(message: string, data?: unknown) {
    write("info", message, data);
  },
  warn(message: string, data?: unknown) {
    write("warn", message, data);
  },
  error(message: string, data?: unknown) {
    write("error", message, data);
  }
};

export default logger;
