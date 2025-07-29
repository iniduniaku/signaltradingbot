const exchangeService = require('./services/exchangeService');
const scannerService = require('./services/scannerService');
const telegramService = require('./services/telegramService');
const tradeMonitor = require('./services/tradeMonitor');
const technicalAnalysis = require('./services/technicalAnalysis');
const fundingRateService = require('./services/fundingRateService');
const config = require('./config/config');
const logger = require('./utils/logger');

class FuturesTradingBot {
  constructor() {
    this.isRunning = false;
    this.startTime = null;
    this.stats = {
      uptime: 0,
      totalScans: 0,
      totalSignals: 0,
      errors: 0
    };
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing Futures Trading Bot...');
      
      // Validate configuration
      this.validateConfiguration();
      
      // Initialize exchange service
      logger.info('📡 Connecting to exchange...');
      await exchangeService.initialize();
      
      // Initialize trade monitoring if enabled
      if (config.features.tradeMonitoring) {
        logger.info('📊 Starting trade monitoring...');
        tradeMonitor.startMonitoring();
      }
      
      // Send startup message
      logger.info('📱 Sending startup notification...');
      await telegramService.sendStartupMessage();
      
      this.isRunning = true;
      this.startTime = new Date();
      
      logger.info('✅ Bot initialization completed successfully!');
      return true;
      
    } catch (error) {
      logger.error(`❌ Bot initialization failed: ${error.message}`);
      throw error;
    }
  }

  validateConfiguration() {
    const required = [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHANNEL_ID'
    ];
    
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }
    
    // Validate numeric configurations
    if (config.scanning.intervalMinutes < 1) {
      throw new Error('Scan interval must be at least 1 minute');
    }
    
    if (config.scanning.maxTokensPerScan > 100) {
      logger.warn('⚠️ Large token scan count may hit API rate limits');
    }
    
    if (config.riskManagement.defaultRiskPercentage > 5) {
      logger.warn('⚠️ High risk percentage detected');
    }
    
    logger.info('✅ Configuration validation passed');
  }

  async startTrading() {
    try {
      if (!this.isRunning) {
        throw new Error('Bot not initialized. Call initialize() first.');
      }
      
      logger.info('🎯 Starting continuous futures trading...');
      
      // Start the main scanning loop
      await scannerService.startContinuousScanning();
      
      // Set up periodic maintenance tasks
      this.scheduleMaintenanceTasks();
      
      logger.info('✅ Futures trading bot is now fully operational!');
      
    } catch (error) {
      logger.error(`❌ Failed to start trading: ${error.message}`);
      throw error;
    }
  }

  scheduleMaintenanceTasks() {
    // Clear caches every hour
    setInterval(() => {
      try {
        technicalAnalysis.clearCache();
        fundingRateService.clearCache();
        logger.info('🧹 Caches cleared');
      } catch (error) {
        logger.error(`Cache clearing error: ${error.message}`);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Send daily statistics
    setInterval(async () => {
      try {
        await this.sendDailyStatistics();
      } catch (error) {
        logger.error(`Daily statistics error: ${error.message}`);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Update statistics every 5 minutes
    setInterval(() => {
      this.updateStatistics();
    }, 5 * 60 * 1000); // 5 minutes

    logger.info('⏰ Maintenance tasks scheduled');
  }

  updateStatistics() {
    try {
      if (this.startTime) {
        this.stats.uptime = Date.now() - this.startTime.getTime();
      }
      
      const scannerStats = scannerService.getStatistics();
      this.stats.totalScans = scannerStats.totalScans;
      this.stats.totalSignals = scannerStats.totalSignals;
      
    } catch (error) {
      logger.error(`Statistics update error: ${error.message}`);
    }
  }

  async sendDailyStatistics() {
    try {
      const scannerStats = scannerService.getStatistics();
      const monitorStats = tradeMonitor.getStatistics();
      
      const message = `
📊 *DAILY PERFORMANCE REPORT*

⏰ *Bot Uptime:* ${this.formatUptime(this.stats.uptime)}

🔍 *Scanning Performance:*
• *Total Scans:* ${scannerStats.totalScans}
• *Daily Signals:* ${scannerStats.dailySignals}
• *Success Rate:* ${scannerStats.avgSuccessRate}%
• *Current Status:* ${scannerStats.isScanning ? 'Scanning 🔄' : 'Idle 💤'}

📈 *Trading Performance:*
• *Active Trades:* ${monitorStats.activeTrades}
• *Completed Trades:* ${monitorStats.completedTrades}
• *Win Rate:* ${monitorStats.recentWinRate}%
• *Avg PnL:* $${monitorStats.recentAvgPnL}
• *Unrealized PnL:* $${monitorStats.totalUnrealizedPnL.toFixed(2)}

🎯 *Configuration:*
• *Min Confidence:* ${config.signal.minConfidence}%
• *Risk per Trade:* ${config.riskManagement.defaultRiskPercentage}%
• *Max Leverage:* ${config.riskManagement.maxLeverage}x

🔧 *System Health:*
• *Exchange:* ${config.exchange.name.toUpperCase()} ✅
• *Trade Monitoring:* ${config.features.tradeMonitoring ? '✅' : '❌'}
• *Funding Analysis:* ${config.features.fundingAnalysis ? '✅' : '❌'}

Keep trading smart! 🚀

#DailyReport #BotPerformance
      `.trim();
      
      await telegramService.sendStatusMessage(message);
      
    } catch (error) {
      logger.error(`Failed to send daily statistics: ${error.message}`);
    }
  }

  formatUptime(uptime) {
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  async gracefulShutdown() {
    try {
      logger.info('🛑 Initiating graceful shutdown...');
      
      this.isRunning = false;
      
      // Stop trade monitoring
      if (config.features.tradeMonitoring) {
        tradeMonitor.stopMonitoring();
      }
      
      // Clean up services
      scannerService.cleanup();
      tradeMonitor.cleanup();
      
      // Send shutdown notification
      const shutdownMessage = `
🛑 *BOT SHUTDOWN*

Bot has been shut down gracefully.

*Final Statistics:*
• *Uptime:* ${this.formatUptime(this.stats.uptime)}
• *Total Scans:* ${this.stats.totalScans}
• *Total Signals:* ${this.stats.totalSignals}

See you next time! 👋

#BotShutdown
      `.trim();
      
      await telegramService.sendStatusMessage(shutdownMessage);
      
      logger.info('✅ Graceful shutdown completed');
      
    } catch (error) {
      logger.error(`❌ Shutdown error: ${error.message}`);
    }
  }

  // Manual control methods
  async forceScan() {
    logger.info('🔧 Manual scan triggered');
    return await scannerService.forceScan();
  }

  getStatus() {
    const scannerStats = scannerService.getStatistics();
    const monitorStats = tradeMonitor.getStatistics();
    
    return {
      isRunning: this.isRunning,
      uptime: this.formatUptime(this.stats.uptime),
      scanner: scannerStats,
      monitor: monitorStats,
      config: {
        exchange: config.exchange.name,
        scanInterval: config.scanning.intervalMinutes,
        minConfidence: config.signal.minConfidence,
        riskPercentage: config.riskManagement.defaultRiskPercentage
      }
    };
  }
}

// Create bot instance
const bot = new FuturesTradingBot();

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  logger.info('📡 Received SIGINT signal');
  await bot.gracefulShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('📡 Received SIGTERM signal');
  await bot.gracefulShutdown();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  logger.error(`💥 Uncaught Exception: ${error.message}`);
  logger.error(error.stack);
  
  try {
    await telegramService.sendErrorAlert(error, 'Uncaught Exception');
  } catch (alertError) {
    logger.error(`Failed to send error alert: ${alertError.message}`);
  }
  
  await bot.gracefulShutdown();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  logger.error(`💥 Unhandled Rejection at:`, promise, 'reason:', reason);
  
  try {
    await telegramService.sendErrorAlert(new Error(reason), 'Unhandled Rejection');
  } catch (alertError) {
    logger.error(`Failed to send error alert: ${alertError.message}`);
  }
});

// Main function to start the bot
async function main() {
  try {
    logger.info('🌟 Starting Futures Trading Bot...');
    
    // Initialize the bot
    await bot.initialize();
    
    // Start trading
    await bot.startTrading();
    
  } catch (error) {
    logger.error(`💥 Fatal error: ${error.message}`);
    
    try {
      await telegramService.sendErrorAlert(error, 'Bot Startup');
    } catch (alertError) {
      logger.error(`Failed to send startup error alert: ${alertError.message}`);
    }
    
    process.exit(1);
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  main();
}

module.exports = bot;
