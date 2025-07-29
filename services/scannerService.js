const exchangeService = require('./exchangeService');
const technicalAnalysis = require('./technicalAnalysis');
const telegramService = require('./telegramService');
const config = require('../config/config');
const logger = require('../utils/logger');

class ScannerService {
  constructor() {
    this.isScanning = false;
    this.scanCount = 0;
    this.totalSignals = 0;
  }

  async scanMarkets() {
    if (this.isScanning) {
      logger.warn('Scan already in progress, skipping...');
      return;
    }

    this.isScanning = true;
    this.scanCount++;
    
    try {
      logger.info(`Starting market scan #${this.scanCount}...`);
      
      // Get top volume tokens
      const tokens = await exchangeService.getTop24hVolumeTokens(config.scanning.maxTokensPerScan);
      
      if (tokens.length === 0) {
        logger.warn('No tokens found for scanning');
        return;
      }

      logger.info(`Scanning ${tokens.length} tokens...`);
      
      let signalsFound = 0;
      const batchSize = 5; // Process in batches to avoid rate limits
      
      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        const promises = batch.map(async (symbol) => {
          try {
            const ohlcv = await exchangeService.getOHLCV(symbol);
            if (ohlcv) {
              const analysis = await technicalAnalysis.analyzeToken(symbol, ohlcv);
              if (analysis && analysis.signal) {
                await telegramService.sendSignal(analysis);
                signalsFound++;
                this.totalSignals++;
                
                // Add delay between signals to avoid spam
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          } catch (error) {
            logger.error(`Error analyzing ${symbol}: ${error.message}`);
          }
        });
        
        await Promise.all(promises);
        
        // Delay between batches
        if (i + batchSize < tokens.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      logger.info(`Scan #${this.scanCount} completed. Found ${signalsFound} signals (Total: ${this.totalSignals})`);
      
      // Send scan summary every 10 scans
      if (this.scanCount % 10 === 0) {
        await this.sendScanSummary(tokens.length, signalsFound);
      }
      
    } catch (error) {
      logger.error(`Market scan error: ${error.message}`);
    } finally {
      this.isScanning = false;
    }
  }

  async sendScanSummary(tokensScanned, signalsFound) {
    const message = `
📊 *Scan Summary #${this.scanCount}*

• *Tokens Scanned:* ${tokensScanned}
• *Signals Found:* ${signalsFound}
• *Total Signals:* ${this.totalSignals}
• *Success Rate:* ${((signalsFound / tokensScanned) * 100).toFixed(1)}%

Keep trading! 📈
    `.trim();
    
    await telegramService.sendStatusMessage(message);
  }

  async startContinuousScanning() {
    logger.info(`Starting continuous scanning every ${config.scanning.intervalMinutes} minutes...`);
    
    // Initial scan
    await this.scanMarkets();
    
    // Set up interval
    setInterval(async () => {
      await this.scanMarkets();
    }, config.scanning.intervalMinutes * 60 * 1000);
  }
}

module.exports = new ScannerService();
