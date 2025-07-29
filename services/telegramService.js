const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../utils/logger');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(config.telegram.token, { polling: false });
    this.channelId = config.telegram.channelId;
  }

  formatSignalMessage(signalData) {
    const { symbol, price, indicators, signal, timestamp } = signalData;
    const emoji = signal.direction === 'LONG' ? '🟢' : '🔴';
    const confidenceEmoji = signal.confidence === 'HIGH' ? '🔥' : '⚡';
    
    return `
${emoji} *${signal.direction} SIGNAL* ${confidenceEmoji}

*Token:* ${symbol}
*Price:* $${price.toFixed(6)}
*Confidence:* ${signal.confidence} (${signal.strength.toFixed(1)}%)
*Time:* ${timestamp.toLocaleString()}

📊 *Technical Analysis:*
• *RSI:* ${indicators.rsi.toFixed(2)} ${this.getRSIStatus(indicators.rsi)}
• *MACD:* ${indicators.macd.macd.toFixed(6)} ${this.getMACDStatus(indicators.macd)}
• *Stochastic:* K:${indicators.stochastic.k.toFixed(2)} D:${indicators.stochastic.d.toFixed(2)}
• *Bollinger:* ${this.getBBStatus(price, indicators.bollinger)}

🎯 *Key Levels:*
• *Pivot:* $${indicators.pivot.pivot.toFixed(6)}
• *R1:* $${indicators.pivot.r1.toFixed(6)} | *S1:* $${indicators.pivot.s1.toFixed(6)}
• *R2:* $${indicators.pivot.r2.toFixed(6)} | *S2:* $${indicators.pivot.s2.toFixed(6)}

⚠️ *This is not financial advice. Trade at your own risk.*
    `.trim();
  }

  getRSIStatus(rsi) {
    if (rsi < 30) return '(Oversold)';
    if (rsi > 70) return '(Overbought)';
    return '(Neutral)';
  }

  getMACDStatus(macd) {
    if (macd.macd > macd.signal) return '(Bullish)';
    if (macd.macd < macd.signal) return '(Bearish)';
    return '(Neutral)';
  }

  getBBStatus(price, bb) {
    if (price < bb.lower) return 'Below Lower Band';
    if (price > bb.upper) return 'Above Upper Band';
    return 'Within Bands';
  }

  async sendSignal(signalData) {
    try {
      const message = this.formatSignalMessage(signalData);
      await this.bot.sendMessage(this.channelId, message, { parse_mode: 'Markdown' });
      logger.info(`Signal sent for ${signalData.symbol}: ${signalData.signal.direction}`);
    } catch (error) {
      logger.error(`Failed to send signal: ${error.message}`);
    }
  }

  async sendStatusMessage(message) {
    try {
      await this.bot.sendMessage(this.channelId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error(`Failed to send status message: ${error.message}`);
    }
  }

  async sendStartupMessage() {
    const message = `
🤖 *Trading Signal Bot Started*

Monitoring all USDT pairs for trading opportunities...
• *Scan Interval:* ${config.scanning.intervalMinutes} minutes
• *Min Volume:* ${config.scanning.minVolumeUSDT.toLocaleString()} USDT
• *Max Tokens per Scan:* ${config.scanning.maxTokensPerScan}
• *Min Confidence:* ${config.signal.minConfidence}%

Bot is now active! 🚀
    `.trim();
    
    await this.sendStatusMessage(message);
  }
}

module.exports = new TelegramService();
