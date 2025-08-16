import winston from "winston";

const logger = winston.createLogger({
  format: winston.format.cli(),
  level: "debug",
  transports: [
    new winston.transports.File({
      filename: process.env.NEOVIM_IDE_COMPANION_LOG_FILE || "/tmp/neovim-ide-companion-nvim.log",
    }),
    new winston.transports.Console(),
  ],
});

export function logError(error: any, message?: string) {
  if (message) {
    logger.error(message);
  }
  if (error instanceof Error) {
    logger.error(error.message);
    logger.error(error.stack);
  } else {
    try {
      logger.error(JSON.stringify(error, null, 2));
    } catch (e) {
      logger.error(String(error))
    }
  }
}
(logger as any).err = logError

type Logger = winston.Logger & {
  err: typeof logError
}


export default logger as Logger;

