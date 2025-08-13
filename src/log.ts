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

export default logger;

