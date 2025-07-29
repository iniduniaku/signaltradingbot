const exchangeService = require('./services/exchangeService');
const scannerService = require('./services/scannerService');
const telegramService = require('./services/telegramService');
const logger = require('./utils/logger');

async function main() {
  try {
    logger.info('Starting Telegram Trading Bot...');
    
    // Initialize exchange
    await exchangeService.initialize();
    
    // Send startup message
    await telegramService.sendStartupMessage();
    
    // Start continuous scanning
    await scannerService.startContinuousScanning();
    
  } catch (error) {
    logger.error(`Failed to start bot: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the application
main();
