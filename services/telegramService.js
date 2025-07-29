const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../utils/logger');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(config.telegram.token, { polling: false });
    this.channelId = config.telegram.channelId;
    this.messageQueue = [];
    this.isProcessingQueue = false;
    this.sentSignals = new Set();
    this.lastMessageTime = 0;
    this.minMessageInterval = 3000; // 3 seconds between messages
  }

  async sendMessage(text, options = {}) {
    try {
      // Add to queue to prevent spam
      this.messageQueue.push({ text, options });
      
      if (!this.isProcessingQueue) {
        await this.processMessageQueue();
      }
    } catch (error) {
      logger.error(`Failed to queue message: ${error.message}`);
    }
  }

  async processMessageQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    while (this.messageQueue.length > 0) {
      const { text, options } = this.messageQueue.shift();
      
      try {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastMessage = now - this.lastMessageTime;
        
        if (timeSinceLastMessage < this.minMessageInterval) {
          await this.delay(this.minMessageInterval - timeSinceLastMessage);
        }
        
        await this.bot.sendMessage(this.channelId, text, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...options 
        });
        
        this.lastMessageTime = Date.now();
        logger.debug('Message sent successfully');
        
      } catch (error) {
        logger.error(`Failed to send message: ${error.message}`);
        
        // If it's a rate limit error, wait longer
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          await this.delay(10000); // Wait 10 seconds
        }
      }
    }
    
    this.isProcessingQueue = false;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  formatSignalMessage(signalData) {
    try {
      const { 
        symbol, 
        currentPrice, 
        entryPrice, 
        takeProfits, 
        stopLoss, 
        riskRewards, 
        positionInfo,
        indicators, 
        signal, 
        timestamp 
      } = signalData;
      
      // Create unique signal ID to prevent duplicates
      const signalId = `${symbol}_${signal.direction}_${Math.floor(timestamp.getTime() / 60000)}`;
      
      if (this.sentSignals.has(signalId)) {
        logger.debug(`Duplicate signal prevented for ${symbol}`);
        return null;
      }
      
      this.sentSignals.add(signalId);
      
      // Clean old signal IDs (older than 1 hour)
      setTimeout(() => this.sentSignals.delete(signalId), 3600000);
      
      const emoji = signal.direction === 'LONG' ? '🟢' : '🔴';
      const confidenceEmoji = signal.confidence === 'HIGH' ? '🔥' : '⚡';
      const directionEmoji = signal.direction === 'LONG' ? '📈' : '📉';
      const riskEmoji = this.getRiskEmoji(signal.riskLevel);
      
      // Calculate percentages
      const entryToTP1 = ((Math.abs(takeProfits.tp1 - entryPrice) / entryPrice) * 100).toFixed(2);
      const entryToTP2 = ((Math.abs(takeProfits.tp2 - entryPrice) / entryPrice) * 100).toFixed(2);
      const entryToTP3 = ((Math.abs(takeProfits.tp3 - entryPrice) / entryPrice) * 100).toFixed(2);
      const entryToSL = ((Math.abs(stopLoss - entryPrice) / entryPrice) * 100).toFixed(2);
      
      const liquidationPrice = this.calculateLiquidationPrice(entryPrice, positionInfo.leverage, signal.direction);
      
      return `
${emoji} *FUTURES ${signal.direction} SIGNAL* ${confidenceEmoji} ${directionEmoji}

🎯 *${symbol} PERPETUAL*
💰 *Mark Price:* $${this.formatPrice(currentPrice)}
🚀 *Entry Price:* $${this.formatPrice(entryPrice)}

📊 *TAKE PROFITS:*
• *TP1:* $${this.formatPrice(takeProfits.tp1)} (+${entryToTP1}%) R:R ${riskRewards[0].toFixed(2)}
• *TP2:* $${this.formatPrice(takeProfits.tp2)} (+${entryToTP2}%) R:R ${riskRewards[1].toFixed(2)}
• *TP3:* $${this.formatPrice(takeProfits.tp3)} (+${entryToTP3}%) R:R ${riskRewards[2].toFixed(2)}

🛡️ *STOP LOSS:* $${this.formatPrice(stopLoss)} (-${entryToSL}%)

💼 *POSITION SETUP:*
• *Risk:* ${positionInfo.riskPercentage}% ($${positionInfo.riskAmount.toFixed(2)})
• *Position Size:* ${this.formatNumber(positionInfo.positionSize)} ${symbol.split('/')[0]}
• *Leverage:* ${positionInfo.leverage}x (Max: ${config.riskManagement.maxLeverage}x)
• *Margin:* $${this.formatNumber(positionInfo.margin)}
• *Liquidation:* $${this.formatPrice(liquidationPrice)} ${riskEmoji}

📈 *SIGNAL QUALITY:*
• *Confidence:* ${signal.confidence} (${signal.strength.toFixed(1)}%)
• *Risk Level:* ${signal.riskLevel} ${riskEmoji}
${signal.warnings && signal.warnings.length > 0 ? `• *Warnings:* ${signal.warnings.join(', ')}` : ''}

📊 *TREND ANALYSIS:*
${this.formatTrendAnalysis(indicators.trend, signal.analysis?.trend)}

⚡ *MOMENTUM INDICATORS:*
${this.formatMomentumAnalysis(indicators.momentum, signal.analysis?.momentum)}

📈 *VOLUME & FLOW:*
${this.formatVolumeAnalysis(indicators.volume, signal.analysis?.volume)}

🔮 *FUTURES SENTIMENT:*
${this.formatFuturesAnalysis(indicators.futures, signal.analysis?.futures)}

⏰ *Signal Time:* ${timestamp.toLocaleString()}

💡 *TRADING STRATEGY:*
• Set limit order at entry: $${this.formatPrice(entryPrice)}
• Take 40% profit at TP1, 35% at TP2, 25% at TP3
• Move SL to breakeven after TP1 hit
• Trail stop with Supertrend after TP2

⚠️ *FUTURES RISK WARNING:* 
Futures trading involves extreme risk. Never risk more than you can afford to lose. Always use proper position sizing and risk management.

#${symbol.replace('/', '')} #${signal.direction} #Futures #TradingSignal
      `.trim();
      
    } catch (error) {
      logger.error(`Error formatting signal message: ${error.message}`);
      return null;
    }
  }

  formatTrendAnalysis(trendIndicators, analysis) {
    const lines = [];
    
    if (analysis?.emaAlignment) {
      lines.push(`• *EMA Stack:* ${this.getEMAStatusText(analysis.emaAlignment)}`);
    }
    
    if (trendIndicators.supertrend && analysis?.supertrend) {
      const st = analysis.supertrend;
      lines.push(`• *Supertrend:* ${st.trend === 1 ? 'Bullish 📈' : 'Bearish 📉'} (${st.distance}%)`);
    }
    
    if (analysis?.marketStructure) {
      const ms = analysis.marketStructure;
      lines.push(`• *Structure:* ${ms.trend} (${(ms.strength * 100).toFixed(0)}% strength)`);
    }
    
    return lines.join('\n');
  }

  formatMomentumAnalysis(momentumIndicators, analysis) {
    const lines = [];
    
    if (analysis?.mfi) {
      lines.push(`• *MFI:* ${analysis.mfi.value} ${this.getStatusEmoji(analysis.mfi.status)}`);
    }
    
    if (analysis?.williamsR) {
      lines.push(`• *Williams %R:* ${analysis.williamsR.value} ${this.getStatusEmoji(analysis.williamsR.status)}`);
    }
    
    if (analysis?.cci) {
      lines.push(`• *CCI:* ${analysis.cci.value} ${this.getStatusEmoji(analysis.cci.status)}`);
    }
    
    return lines.join('\n');
  }

  formatVolumeAnalysis(volumeIndicators, analysis) {
    const lines = [];
    
    if (analysis?.vwap) {
      const vwap = analysis.vwap;
      lines.push(`• *VWAP:* $${vwap.value} (${vwap.difference}%) ${this.getVWAPEmoji(vwap.status)}`);
    }
    
    if (analysis?.obv) {
      lines.push(`• *Volume Flow:* ${analysis.obv.trend} ${analysis.obv.value === 'POSITIVE' ? '📈' : '📉'}`);
    }
    
    return lines.join('\n');
  }

  formatFuturesAnalysis(futuresIndicators, analysis) {
    const lines = [];
    
    if (analysis?.fundingRate) {
      const fr = analysis.fundingRate;
      lines.push(`• *Funding:* ${fr.value}% (${fr.annualized}% APR) ${this.getFundingEmoji(fr.bias)}`);
    }
    
    if (futuresIndicators.openInterest) {
      lines.push(`• *Open Interest:* ${this.formatNumber(futuresIndicators.openInterest)} ${this.getOIEmoji()}`);
    }
    
    if (analysis?.liquidations) {
      const liq = analysis.liquidations;
      lines.push(`• *Liquidations:* ${liq.bias} (${(parseFloat(liq.ratio) * 100).toFixed(1)}% longs) ${this.getLiquidationEmoji(liq.bias)}`);
    }
    
    return lines.join('\n');
  }

  // Helper methods for emojis and formatting
  getRiskEmoji(riskLevel) {
    switch (riskLevel) {
      case 'LOW': return '🟢';
      case 'MEDIUM': return '🟡';
      case 'HIGH': return '🟠';
      case 'EXTREME': return '🔴';
      default: return '⚪';
    }
  }

  getEMAStatusText(alignment) {
    switch (alignment) {
      case 'STRONG_BULL': return 'Strong Bullish 🐂';
      case 'STRONG_BEAR': return 'Strong Bearish 🐻';
      case 'BULL': return 'Bullish 📈';
      case 'BEAR': return 'Bearish 📉';
      case 'WEAK_BULL': return 'Weak Bullish 📈';
      case 'WEAK_BEAR': return 'Weak Bearish 📉';
      default: return 'Neutral ⚖️';
    }
  }

  getStatusEmoji(status) {
    switch (status) {
      case 'OVERSOLD': return '🔥';
      case 'OVERBOUGHT': return '🔥';
      case 'BULLISH': return '📈';
      case 'BEARISH': return '📉';
      default: return '⚖️';
    }
  }

  getVWAPEmoji(status) {
    switch (status) {
      case 'STRONG_ABOVE': return '🚀';
      case 'ABOVE': return '📈';
      case 'STRONG_BELOW': return '💥';
      case 'BELOW': return '📉';
      default: return '⚖️';
    }
  }

  getFundingEmoji(bias) {
    switch (bias) {
      case 'BULLISH': return '🐂';
      case 'BEARISH': return '🐻';
      case 'SLIGHTLY_BULLISH': return '📈';
      case 'SLIGHTLY_BEARISH': return '📉';
      default: return '⚖️';
    }
  }

  getOIEmoji() {
    return '📊';
  }

  getLiquidationEmoji(bias) {
    switch (bias) {
      case 'BULLISH': return '🔥';
      case 'BEARISH': return '💥';
      default: return '⚖️';
    }
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

  formatNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  calculateLiquidationPrice(entryPrice, leverage, direction) {
    const liquidationDistance = (1 / leverage) * 0.9; // 90% to account for fees
    
    if (direction === 'LONG') {
      return entryPrice * (1 - liquidationDistance);
    } else {
      return entryPrice * (1 + liquidationDistance);
    }
  }

  async sendSignal(signalData) {
    try {
      const message = this.formatSignalMessage(signalData);
      
      if (!message) {
        logger.debug('Signal message not generated (duplicate or error)');
        return;
      }
      
      await this.sendMessage(message);
      logger.info(`Signal sent for ${signalData.symbol}: ${signalData.signal.direction}`);
      
    } catch (error) {
      logger.error(`Failed to send signal: ${error.message}`);
    }
  }

  async sendTradeUpdate(symbol, updateType, price, message) {
    try {
      const emoji = this.getUpdateEmoji(updateType);
      
      const updateMessage = `
${emoji} *TRADE UPDATE*

*${symbol}*
*${updateType.replace('_', ' ')}* at $${this.formatPrice(price)}

${message}

#TradeUpdate #${symbol.replace('/', '')}
      `.trim();
      
      await this.sendMessage(updateMessage);
      logger.info(`Trade update sent for ${symbol}: ${updateType}`);
      
    } catch (error) {
      logger.error(`Failed to send trade update: ${error.message}`);
    }
  }

  getUpdateEmoji(updateType) {
    switch (updateType) {
      case 'TP_HIT': return '🎯';
      case 'SL_HIT': return '🛑';
      case 'ENTRY_FILLED': return '✅';
      case 'PARTIAL_FILL': return '📊';
      default: return '📢';
    }
  }

  async sendStatusMessage(message) {
    try {
      await this.sendMessage(message);
    } catch (error) {
      logger.error(`Failed to send status message: ${error.message}`);
    }
  }

  async sendStartupMessage() {
    const message = `
🚀 *FUTURES TRADING BOT ACTIVATED* 🚀

⚙️ *Configuration:*
• *Exchange:* ${config.exchange.name.toUpperCase()}
• *Scan Interval:* ${config.scanning.intervalMinutes} minutes
• *Min Volume:* ${this.formatNumber(config.scanning.minVolumeUSDT)} USDT
• *Max Tokens:* ${config.scanning.maxTokensPerScan} per scan
• *Min Confidence:* ${config.signal.minConfidence}%
• *Risk per Trade:* ${config.riskManagement.defaultRiskPercentage}%

📊 *Advanced Features:*
• Multi-timeframe analysis ✅
• Funding rate monitoring ${config.features.fundingAnalysis ? '✅' : '❌'}
• Liquidation tracking ${config.features.liquidationAnalysis ? '✅' : '❌'}
• Trade monitoring ${config.features.tradeMonitoring ? '✅' : '❌'}

🎯 *Signal Quality:*
• EMA trend confirmation
• Supertrend direction
• Volume flow analysis
• Market structure validation
• Funding rate sentiment
• Liquidation bias

⚡ *Bot Status:* ACTIVE
🔄 *Next Scan:* ${config.scanning.intervalMinutes} minutes

⚠️ *Risk Disclaimer:* All signals are for educational purposes. Trade responsibly and never risk more than you can afford to lose.

Happy Trading! 📈💰

#BotStarted #FuturesTrading #CryptoSignals
    `.trim();
    
    await this.sendStatusMessage(message);
  }

  async sendScanSummary(tokensScanned, signalsFound, scanNumber, totalSignals) {
    const successRate = tokensScanned > 0 ? ((signalsFound / tokensScanned) * 100).toFixed(1) : '0.0';
    
    const message = `
📊 *SCAN SUMMARY #${scanNumber}*

🔍 *Scan Results:*
• *Tokens Analyzed:* ${tokensScanned}
• *Signals Generated:* ${signalsFound}
• *Success Rate:* ${successRate}%
• *Total Signals Today:* ${totalSignals}

📈 *Performance:*
• *Quality Threshold:* ${config.signal.minConfidence}%+ confidence
• *Risk Management:* Active ✅
• *Duplicate Prevention:* Active ✅

⏰ *Next Scan:* ${config.scanning.intervalMinutes} minutes

Keep monitoring the markets! 🚀

#ScanSummary #MarketAnalysis
    `.trim();
    
    await this.sendStatusMessage(message);
  }

  async sendErrorAlert(error, context) {
    const message = `
🚨 *BOT ERROR ALERT* 🚨

*Context:* ${context}
*Error:* ${error.message}
*Time:* ${new Date().toLocaleString()}

Bot will attempt to recover automatically.

#ErrorAlert #BotStatus
    `.trim();
    
    try {
      await this.sendMessage(message);
    } catch (sendError) {
      logger.error(`Failed to send error alert: ${sendError.message}`);
    }
  }
}

module.exports = new TelegramService();
