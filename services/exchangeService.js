const ccxt = require('ccxt');
const config = require('../config/config');
const logger = require('../utils/logger');

class ExchangeService {
  constructor() {
    this.exchange = null;
    this.markets = null;
    this.lastMarketUpdate = null;
    this.rateLimitQueue = [];
    this.isProcessingQueue = false;
  }

  async initialize() {
    try {
      const ExchangeClass = ccxt[config.exchange.name];
      this.exchange = new ExchangeClass({
        ...config.exchange.options,
        sandbox: config.exchange.sandbox
      });

      await this.exchange.loadMarkets();
      this.markets = this.exchange.markets;
      this.lastMarketUpdate = Date.now();
      
      logger.info(`Exchange ${config.exchange.name} initialized with ${Object.keys(this.markets).length} markets`);
    } catch (error) {
      logger.error(`Failed to initialize exchange: ${error.message}`);
      throw error;
    }
  }

  async refreshMarkets() {
    try {
      if (Date.now() - this.lastMarketUpdate > 3600000) { // 1 hour
        await this.exchange.loadMarkets(true);
        this.markets = this.exchange.markets;
        this.lastMarketUpdate = Date.now();
        logger.info('Markets refreshed');
      }
    } catch (error) {
      logger.error(`Failed to refresh markets: ${error.message}`);
    }
  }

  async getAllUSDTFutures() {
    try {
      await this.refreshMarkets();

      const futuresTokens = Object.keys(this.markets)
        .filter(symbol => {
          const market = this.markets[symbol];
          return market.quote === 'USDT' && 
                 market.type === 'swap' && // Perpetual futures
                 market.active &&
                 !symbol.includes('DOWN') &&
                 !symbol.includes('UP') &&
                 !symbol.includes('BEAR') &&
                 !symbol.includes('BULL');
        });

      logger.info(`Found ${futuresTokens.length} USDT perpetual futures`);
      return futuresTokens;
    } catch (error) {
      logger.error(`Error fetching USDT futures: ${error.message}`);
      return [];
    }
  }

  async getTopVolumeFutures(limit = 30) {
    try {
      const tokens = await this.getAllUSDTFutures();
      const tickers = await this.exchange.fetchTickers();
      
      const volumeData = tokens
        .map(symbol => ({
          symbol,
          volume: tickers[symbol]?.quoteVolume || 0,
          price: tickers[symbol]?.last || 0,
          change: tickers[symbol]?.percentage || 0
        }))
        .filter(token => token.volume >= config.scanning.minVolumeUSDT)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);

      logger.info(`Selected ${volumeData.length} futures with minimum volume ${config.scanning.minVolumeUSDT} USDT`);
      return volumeData.map(token => token.symbol);
    } catch (error) {
      logger.error(`Error getting top volume futures: ${error.message}`);
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

  async getTicker(symbol) {
    try {
      return await this.exchange.fetchTicker(symbol);
    } catch (error) {
      logger.error(`Error fetching ticker for ${symbol}: ${error.message}`);
      return null;
    }
  }
}

module.exports = new ExchangeService();
