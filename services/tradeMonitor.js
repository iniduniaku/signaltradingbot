const exchangeService = require('./exchangeService');
const telegramService = require('./telegramService');
const config = require('../config/config');
const logger = require('../utils/logger');

class TradeMonitor {
  constructor() {
    this.activeTrades = new Map();
    this.completedTrades = [];
    this.monitoringInterval = null;
    this.isMonitoring = false;
    this.maxCompletedTrades = 50;
    this.checkIntervalMs = 2 * 60 * 1000; // 2 minutes
  }

  addTrade(signalData) {
    if (!config.features.tradeMonitoring) {
      return null;
    }

    try {
      const tradeId = this.generateTradeId(signalData);
      
      const trade = {
        id: tradeId,
        symbol: signalData.symbol,
        direction: signalData.signal.direction,
        entryPrice: signalData.entryPrice,
        currentPrice: signalData.currentPrice,
        takeProfits: signalData.takeProfits,
        stopLoss: signalData.stopLoss,
        positionInfo: signalData.positionInfo,
        signal: signalData.signal,
        timestamp: signalData.timestamp,
        status: 'ACTIVE',
        tpHit: {
          tp1: false,
          tp2: false,
          tp3: false
        },
        slHit: false,
        entryFilled: false,
        notifications: [],
        lastChecked: null,
        pnl: 0,
        maxPnl: 0,
        minPnl: 0
      };
      
      this.activeTrades.set(tradeId, trade);
      
      logger.info(`📊 Trade ${tradeId} added to monitor (${signalData.symbol} ${signalData.signal.direction})`);
      
      return tradeId;
    } catch (error) {
      logger.error(`Failed to add trade to monitor: ${error.message}`);
      return null;
    }
  }

  generateTradeId(signalData) {
    const timestamp = signalData.timestamp.getTime();
    const symbol = signalData.symbol.replace('/', '');
    const direction = signalData.signal.direction;
    return `${symbol}_${direction}_${timestamp}`.substring(0, 32);
  }

  async monitorTrades() {
    if (!config.features.tradeMonitoring || this.activeTrades.size === 0) {
      return;
    }

    logger.debug(`🔍 Monitoring ${this.activeTrades.size} active trades...`);

    const tradesToCheck = Array.from(this.activeTrades.values());
    
    // Process trades in batches to avoid API rate limits
    const batchSize = 5;
    for (let i = 0; i < tradesToCheck.length; i += batchSize) {
      const batch = tradesToCheck.slice(i, i + batchSize);
      
      const promises = batch.map(trade => this.checkTradeStatus(trade));
      await Promise.allSettled(promises);
      
      // Small delay between batches
      if (i + batchSize < tradesToCheck.length) {
        await this.delay(1000);
      }
    }
  }

  async checkTradeStatus(trade) {
    try {
      // Get current price
      const currentPrice = await exchangeService.getCurrentPrice(trade.symbol);
      
      if (!currentPrice) {
        logger.debug(`Unable to get price for ${trade.symbol}`);
        return;
      }

      // Update trade data
      trade.currentPrice = currentPrice;
      trade.lastChecked = new Date();
      
      // Calculate PnL
      this.calculatePnL(trade, currentPrice);
      
      // Check for entry fill (if using limit orders)
      if (!trade.entryFilled) {
        const entryFilled = this.checkEntryFill(trade, currentPrice);
        if (entryFilled) {
          trade.entryFilled = true;
          await this.sendTradeNotification(trade, 'ENTRY_FILLED', currentPrice, 
            `Entry order filled! Position is now active.`);
        }
      }

      // Only check TP/SL if entry is filled
      if (trade.entryFilled) {
        await this.checkTakeProfitLevels(trade, currentPrice);
        await this.checkStopLoss(trade, currentPrice);
      }

      // Check for trade expiry (24 hours)
      this.checkTradeExpiry(trade);

    } catch (error) {
      logger.error(`Error checking trade ${trade.id}: ${error.message}`);
    }
  }

  checkEntryFill(trade, currentPrice) {
    const direction = trade.direction;
    const entryPrice = trade.entryPrice;
    
    if (direction === 'LONG') {
      // Long entry filled if price drops to or below entry price
      return currentPrice <= entryPrice;
    } else {
      // Short entry filled if price rises to or above entry price
      return currentPrice >= entryPrice;
    }
  }

  calculatePnL(trade, currentPrice) {
    if (!trade.entryFilled) {
      trade.pnl = 0;
      return;
    }

    const direction = trade.direction;
    const entryPrice = trade.entryPrice;
    const positionSize = trade.positionInfo.positionSize;
    const leverage = trade.positionInfo.leverage;
    
    let pnlPercentage;
    
    if (direction === 'LONG') {
      pnlPercentage = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      pnlPercentage = ((entryPrice - currentPrice) / entryPrice) * 100;
    }
    
    // Apply leverage
    const leveragedPnL = pnlPercentage * leverage;
    const pnlUSD = (trade.positionInfo.margin * leveragedPnL) / 100;
    
    trade.pnl = pnlUSD;
    trade.pnlPercentage = leveragedPnL;
    
    // Track max/min PnL
    trade.maxPnl = Math.max(trade.maxPnl, pnlUSD);
    trade.minPnl = Math.min(trade.minPnl, pnlUSD);
  }

  async checkTakeProfitLevels(trade, currentPrice) {
    const direction = trade.direction;
    const { tp1, tp2, tp3 } = trade.takeProfits;
    
    // Check TP1
    if (!trade.tpHit.tp1) {
      const tp1Hit = direction === 'LONG' 
        ? currentPrice >= tp1 
        : currentPrice <= tp1;
        
      if (tp1Hit) {
        trade.tpHit.tp1 = true;
        await this.sendTradeNotification(trade, 'TP_HIT', currentPrice,
          `🎯 TP1 Hit! Take 40% profit at $${this.formatPrice(currentPrice)}. Move SL to breakeven.`);
      }
    }

    // Check TP2 (only if TP1 hit)
    if (trade.tpHit.tp1 && !trade.tpHit.tp2) {
      const tp2Hit = direction === 'LONG' 
        ? currentPrice >= tp2 
        : currentPrice <= tp2;
        
      if (tp2Hit) {
        trade.tpHit.tp2 = true;
        await this.sendTradeNotification(trade, 'TP_HIT', currentPrice,
          `🎯 TP2 Hit! Take 35% more profit at $${this.formatPrice(currentPrice)}. Trail SL with Supertrend.`);
      }
    }

    // Check TP3 (only if TP2 hit)
    if (trade.tpHit.tp2 && !trade.tpHit.tp3) {
      const tp3Hit = direction === 'LONG' 
        ? currentPrice >= tp3 
        : currentPrice <= tp3;
        
      if (tp3Hit) {
        trade.tpHit.tp3 = true;
        trade.status = 'COMPLETED';
        
        await this.sendTradeNotification(trade, 'TP_HIT', currentPrice,
          `🎯 TP3 Hit! All targets reached! Final 25% profit taken. Trade completed successfully! 🎉\n\nFinal PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercentage.toFixed(2)}%)`);
        
        this.completeTrade(trade, 'TP3_HIT');
      }
    }
  }

  async checkStopLoss(trade, currentPrice) {
    if (trade.slHit) return;

    const direction = trade.direction;
    const stopLoss = trade.stopLoss;
    
    const slHit = direction === 'LONG' 
      ? currentPrice <= stopLoss 
      : currentPrice >= stopLoss;
      
    if (slHit) {
      trade.slHit = true;
      trade.status = 'STOPPED_OUT';
      
      await this.sendTradeNotification(trade, 'SL_HIT', currentPrice,
        `🛑 Stop Loss Hit! Position closed at $${this.formatPrice(currentPrice)}.\n\nFinal PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercentage.toFixed(2)}%)`);
      
      this.completeTrade(trade, 'STOP_LOSS');
    }
  }

  checkTradeExpiry(trade) {
    const now = Date.now();
    const tradeAge = now - trade.timestamp.getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (tradeAge > maxAge && trade.status === 'ACTIVE') {
      trade.status = 'EXPIRED';
      
      this.sendTradeNotification(trade, 'EXPIRED', trade.currentPrice,
        `⏰ Trade expired after 24 hours. Consider manual review.\n\nCurrent PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercentage.toFixed(2)}%)`);
      
      this.completeTrade(trade, 'EXPIRED');
    }
  }

  async sendTradeNotification(trade, type, price, message) {
    try {
      const notification = {
        type,
        price,
        message,
        timestamp: new Date()
      };
      
      trade.notifications.push(notification);
      
      await telegramService.sendTradeUpdate(trade.symbol, type, price, message);
      
      logger.info(`📢 Trade notification sent for ${trade.id}: ${type}`);
      
    } catch (error) {
      logger.error(`Failed to send trade notification: ${error.message}`);
    }
  }

  completeTrade(trade, reason) {
    try {
      // Calculate final statistics
      const duration = Date.now() - trade.timestamp.getTime();
      const completedTrade = {
        ...trade,
        completedAt: new Date(),
        duration,
        completionReason: reason,
        finalPnL: trade.pnl,
        maxDrawdown: trade.minPnl,
        maxProfit: trade.maxPnl
      };
      
      // Add to completed trades
      this.completedTrades.unshift(completedTrade);
      
      // Keep only recent completed trades
      if (this.completedTrades.length > this.maxCompletedTrades) {
        this.completedTrades = this.completedTrades.slice(0, this.maxCompletedTrades);
      }
      
      // Remove from active trades
      this.activeTrades.delete(trade.id);
      
      logger.info(`✅ Trade ${trade.id} completed: ${reason}`);
      
    } catch (error) {
      logger.error(`Error completing trade ${trade.id}: ${error.message}`);
    }
  }

  startMonitoring() {
    if (!config.features.tradeMonitoring) {
      logger.info('Trade monitoring is disabled');
      return;
    }

    if (this.isMonitoring) {
      logger.warn('Trade monitoring already started');
      return;
    }

    this.isMonitoring = true;
    
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.monitorTrades();
      } catch (error) {
        logger.error(`Trade monitoring error: ${error.message}`);
      }
    }, this.checkIntervalMs);
    
    logger.info(`📊 Trade monitoring started (checking every ${this.checkIntervalMs / 1000}s)`);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.isMonitoring = false;
    logger.info('📊 Trade monitoring stopped');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  formatPrice(price) {
    if (price >= 1) {
      return price.toFixed(4);
    } else if (price >= 0.01) {
      return price.toFixed(6);
    } else {
      return price.toFixed(8);
    }
  }

  // Get monitoring statistics
  getStatistics() {
    const activeTrades = Array.from(this.activeTrades.values());
    const totalPnL = activeTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    
    const recentCompleted = this.completedTrades.slice(0, 10);
    const winRate = recentCompleted.length > 0 
      ? (recentCompleted.filter(trade => trade.finalPnL > 0).length / recentCompleted.length) * 100 
      : 0;
    
    const avgPnL = recentCompleted.length > 0 
      ? recentCompleted.reduce((sum, trade) => sum + trade.finalPnL, 0) / recentCompleted.length 
      : 0;

    return {
      activeTrades: this.activeTrades.size,
      completedTrades: this.completedTrades.length,
      isMonitoring: this.isMonitoring,
      totalUnrealizedPnL: totalPnL,
      recentWinRate: winRate.toFixed(1),
      recentAvgPnL: avgPnL.toFixed(2),
      lastCheck: activeTrades.length > 0 ? activeTrades[0].lastChecked : null
    };
  }

  // Manual trade management methods
  async forceCheckTrade(tradeId) {
    const trade = this.activeTrades.get(tradeId);
    if (trade) {
      await this.checkTradeStatus(trade);
      return trade;
    }
    return null;
  }

  removeTrade(tradeId, reason = 'MANUAL_REMOVAL') {
    const trade = this.activeTrades.get(tradeId);
    if (trade) {
      this.completeTrade(trade, reason);
      return true;
    }
    return false;
  }

  getActiveTrades() {
    return Array.from(this.activeTrades.values());
  }

  getCompletedTrades(limit = 10) {
    return this.completedTrades.slice(0, limit);
  }

  // Clean up resources
  cleanup() {
    this.stopMonitoring();
    this.activeTrades.clear();
    this.completedTrades = [];
    logger.info('Trade monitor cleaned up');
  }
}

module.exports = new TradeMonitor();
