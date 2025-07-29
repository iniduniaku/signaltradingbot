const exchangeService = require('./exchangeService');
const technicalAnalysis = require('./technicalAnalysis');
const telegramService = require('./telegramService');
const tradeMonitor = require('./tradeMonitor');
const config = require('../config/config');
const logger = require('../utils/logger');

class ScannerService {
  constructor() {
    this.isScanning = false;
    this.scanCount = 0;
    this.totalSignals = 0;
    this.dailySignals = 0;
    this.lastResetDate = new Date().toDateString();
    this.scanHistory = [];
    this.maxHistoryLength = 100;
    this.errorCount = 0;
    this.maxErrors = 10;
  }

  async scanMarkets() {
    if (this.isScanning) {
      logger.warn('Scan already in progress, skipping...');
      return;
    }

    this.isScanning = true;
    this.scanCount++;
    
    const scanStartTime = Date.now();
    let signalsFound = 0;
    let tokensAnalyzed = 0;
    let errors = 0;

    try {
      logger.info(`🔍 Starting market scan #${this.scanCount}...`);
      
      // Reset daily counter if new day
      this.resetDailyCounterIfNeeded();
      
      // Get top volume futures
      const tokens = await exchangeService.getTopVolumeFutures(config.scanning.maxTokensPerScan);
      
      if (tokens.length === 0) {
        logger.warn('No tokens found for scanning');
        return;
      }

      logger.info(`📊 Scanning ${tokens.length} top volume futures...`);
      
      // Process tokens in batches to manage rate limits
      const batchSize = 3;
      const batches = this.createBatches(tokens, batchSize);
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        logger.debug(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} tokens)`);
        
        const batchPromises = batch.map(symbol => this.analyzeToken(symbol));
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          tokensAnalyzed++;
          
          if (result.status === 'fulfilled' && result.value) {
            const analysis = result.value;
            
            if (analysis.signal) {
              try {
                await telegramService.sendSignal(analysis);
                
                // Add to trade monitor if enabled
                if (config.features.tradeMonitoring) {
                  tradeMonitor.addTrade(analysis);
                }
                
                signalsFound++;
                this.totalSignals++;
                this.dailySignals++;
                
                logger.info(`✅ Signal generated for ${analysis.symbol}: ${analysis.signal.direction} (${analysis.signal.confidence})`);
                
                // Rate limiting between signals
                await this.delay(2000);
                
              } catch (error) {
                logger.error(`Failed to process signal for ${analysis.symbol}: ${error.message}`);
                errors++;
              }
            }
          } else if (result.status === 'rejected') {
            logger.debug(`Token analysis failed: ${result.reason.message}`);
            errors++;
          }
        }
        
        // Delay between batches to manage API rate limits
        if (batchIndex < batches.length - 1) {
          await this.delay(1000);
        }
      }

      const scanDuration = Date.now() - scanStartTime;
      
      // Record scan statistics
      const scanStats = {
        scanNumber: this.scanCount,
        timestamp: new Date(),
        tokensAnalyzed,
        signalsFound,
        errors,
        duration: scanDuration,
        successRate: tokensAnalyzed > 0 ? (signalsFound / tokensAnalyzed * 100) : 0
      };
      
      this.recordScanHistory(scanStats);
      
      logger.info(`✅ Scan #${this.scanCount} completed in ${(scanDuration / 1000).toFixed(2)}s`);
      logger.info(`📊 Results: ${signalsFound} signals from ${tokensAnalyzed} tokens (${scanStats.successRate.toFixed(1)}% success rate)`);
      
      // Send periodic scan summary
      if (this.scanCount % 10 === 0) {
        await this.sendDetailedScanSummary(tokensAnalyzed, signalsFound);
      }
      
      // Reset error count on successful scan
      this.errorCount = 0;
      
    } catch (error) {
      logger.error(`💥 Market scan #${this.scanCount} failed: ${error.message}`);
      this.errorCount++;
      
      // Send error alert if too many consecutive errors
      if (this.errorCount >= this.maxErrors) {
        await telegramService.sendErrorAlert(error, `Market scan #${this.scanCount}`);
        this.errorCount = 0; // Reset to prevent spam
      }
      
    } finally {
      this.isScanning = false;
    }
  }

  async analyzeToken(symbol) {
    try {
      // Get OHLCV data
      const ohlcv = await exchangeService.getOHLCV(
        symbol, 
        config.scanning.timeframe, 
        config.scanning.candleLimit
      );
      
      if (!ohlcv || ohlcv.length < 60) {
        return null;
      }
      
      // Perform technical analysis
      const analysis = await technicalAnalysis.analyzeToken(symbol, ohlcv);
      
      if (analysis) {
        logger.debug(`✅ Analysis completed for ${symbol}: ${analysis.signal?.direction || 'No signal'}`);
      }
      
      return analysis;
      
    } catch (error) {
      logger.debug(`❌ Analysis failed for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  resetDailyCounterIfNeeded() {
    const currentDate = new Date().toDateString();
    if (currentDate !== this.lastResetDate) {
      this.dailySignals = 0;
      this.lastResetDate = currentDate;
      logger.info('📅 Daily signal counter reset');
    }
  }

  recordScanHistory(scanStats) {
    this.scanHistory.unshift(scanStats);
    
    // Keep only recent history
    if (this.scanHistory.length > this.maxHistoryLength) {
      this.scanHistory = this.scanHistory.slice(0, this.maxHistoryLength);
    }
  }

  async sendDetailedScanSummary(tokensAnalyzed, signalsFound) {
    try {
      // Calculate recent performance
      const recentScans = this.scanHistory.slice(0, 10);
      const avgSuccessRate = recentScans.length > 0 
        ? recentScans.reduce((sum, scan) => sum + scan.successRate, 0) / recentScans.length 
        : 0;
      
      const avgDuration = recentScans.length > 0
        ? recentScans.reduce((sum, scan) => sum + scan.duration, 0) / recentScans.length / 1000
        : 0;
      
      await telegramService.sendScanSummary(
        tokensAnalyzed, 
        signalsFound, 
        this.scanCount, 
        this.dailySignals
      );
      
      // Send performance metrics
      const performanceMessage = `
📈 *PERFORMANCE METRICS*

🎯 *Recent Performance (10 scans):*
• *Avg Success Rate:* ${avgSuccessRate.toFixed(1)}%
• *Avg Scan Duration:* ${avgDuration.toFixed(1)}s
• *Total Scans Today:* ${this.scanCount}

📊 *Signal Quality:*
• *Daily Signals:* ${this.dailySignals}
• *Success Threshold:* ${config.signal.minConfidence}%
• *Risk Level Filter:* Active ✅

🔧 *System Health:*
• *Error Rate:* ${this.errorCount}/${this.maxErrors}
• *Cache Status:* Active ✅
• *Rate Limiting:* Active ✅

Next detailed summary in 10 scans.

#Performance #BotStatus
      `.trim();
      
      await telegramService.sendStatusMessage(performanceMessage);
      
    } catch (error) {
      logger.error(`Failed to send detailed scan summary: ${error.message}`);
    }
  }

  async startContinuousScanning() {
    logger.info(`🚀 Starting continuous futures scanning every ${config.scanning.intervalMinutes} minutes...`);
    
    // Perform initial scan
    await this.scanMarkets();
    
    // Set up interval for continuous scanning
    const intervalMs = config.scanning.intervalMinutes * 60 * 1000;
    
    setInterval(async () => {
      try {
        await this.scanMarkets();
      } catch (error) {
        logger.error(`Interval scan error: ${error.message}`);
      }
    }, intervalMs);
    
    logger.info(`⏰ Continuous scanning scheduled every ${config.scanning.intervalMinutes} minutes`);
  }

  // Method to manually trigger a scan (useful for testing)
  async forceScan() {
    logger.info('🔧 Manual scan triggered');
    await this.scanMarkets();
  }

  // Get current scanner statistics
  getStatistics() {
    const recentScans = this.scanHistory.slice(0, 10);
    const avgSuccessRate = recentScans.length > 0 
      ? recentScans.reduce((sum, scan) => sum + scan.successRate, 0) / recentScans.length 
      : 0;

    return {
      totalScans: this.scanCount,
      totalSignals: this.totalSignals,
      dailySignals: this.dailySignals,
      isScanning: this.isScanning,
      avgSuccessRate: avgSuccessRate.toFixed(1),
      errorCount: this.errorCount,
      lastScan: this.scanHistory[0]?.timestamp || null,
      recentScans: recentScans.length
    };
  }

  // Clean up resources
  cleanup() {
    this.scanHistory = [];
    this.errorCount = 0;
    this.isScanning = false;
    logger.info('Scanner service cleaned up');
  }
}

module.exports = new ScannerService();
