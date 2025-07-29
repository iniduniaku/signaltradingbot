const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config/config');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
fs.ensureDirSync(logsDir);

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'futures-trading-bot' },
  transports: []
});

// Console transport
logger.add(new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
    winston.format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp} [${service}] ${level}: ${message}`;
    })
  )
}));

// File transports (if enabled)
if (config.logging.toFile) {
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    maxsize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles
  }));

  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    maxsize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles
  }));
}

module.exports = logger;
