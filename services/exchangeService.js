const ccxt = require('ccxt');
const config = require('../config/config');
const logger = require('../utils/logger');

class ExchangeService {
  constructor() {
    this.exchange = new ccxt[config.exchange.name](config.exchange.options);
    this.markets = null;
    this.lastMarketUpdate = null;
  }

  async initialize() {
    try {
      await this.exchange.loadMarkets();
      this.markets = this.exchange.markets;
      this.lastMarketUpdate = Date.now();
      logger.info(`Exchange initialized with ${Object.keys(this.markets).length} markets`);
    } catch (error) {
      logger.error(`Failed to initialize exchange: ${error.message}`);
      throw error;
    }
  }

  async getAllUSDTTokens() {
    try {
      // Refresh markets if older than 1 hour
      if (!this.markets || Date.now() - this.lastMarketUpdate > 3600000) {
        await this.initialize();
      }

      const usdtTokens = Object.keys(this.markets)
        .filter(symbol => {
          const market = this.markets[symbol];
          return market.quote === 'USDT' && 
                 market.spot && 
                 market.active &&
                 !symbol.includes('DOWN') &&
                 !symbol.includes('UP') &&
                 !symbol.includes('BEAR') &&
                 !symbol.includes('BULL');
        });

      logger.info(`Found ${usdtTokens.length} USDT trading pairs`);
      return usdtTokens;
    } catch (error) {
      logger.error(`Error fetching USDT tokens: ${error.message}`);
      return [];
    }
  }

  async getTop24hVolumeTokens(limit = 50) {
    try {
      const tokens = await this.getAllUSDTTokens();
      const tickers = await this.exchange.fetchTickers();
      
      const volumeData = tokens
        .map(symbol => ({
          symbol,
          volume: tickers[symbol]?.quoteVolume || 0,
          price: tickers[symbol]?.last || 0
        }))
        .filter(token => token.volume >= config.scanning.minVolumeUSDT)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);

      logger.info(`Selected ${volumeData.length} tokens with minimum volume ${config.scanning.minVolumeUSDT} USDT`);
      return volumeData.map(token => token.symbol);
    } catch (error) {
      logger.error(`Error getting top volume tokens: ${error.message}`);
      return [];
    }
  }

  async getOHLCV(symbol, timeframe = '1h', limit = 100) {
    try {
      const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      return ohlcv.map(candle => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));
    } catch (error) {
      logger.error(`Error fetching OHLCV for ${symbol}: ${error.message}`);
      return null;
    }
  }

  async getCurrentPrice(symbol) {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      return ticker.last;
    } catch (error) {
      logger.error(`Error fetching price for ${symbol}: ${error.message}`);
      return null;
    }
  }
}

module.exports = new ExchangeService();
