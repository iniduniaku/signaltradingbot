const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

class FundingRateService {
  constructor() {
    this.baseURL = 'https://fapi.binance.com';
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  getCacheKey(symbol, endpoint) {
    return `${endpoint}_${symbol}`;
  }

  isValidCacheEntry(entry) {
    return entry && (Date.now() - entry.timestamp) < this.cacheExpiry;
  }

  async getFundingRate(symbol) {
    try {
      if (!config.features.fundingAnalysis) return null;
      
      const cacheKey = this.getCacheKey(symbol, 'funding');
      const cached = this.cache.get(cacheKey);
      
      if (this.isValidCacheEntry(cached)) {
        return cached.data;
      }

      const futuresSymbol = symbol.replace('/', '');
      
      const response = await axios.get(`${this.baseURL}/fapi/v1/premiumIndex`, {
        params: { symbol: futuresSymbol },
        timeout: 10000
      });
      
      const data = {
        symbol: symbol,
        fundingRate: parseFloat(response.data.lastFundingRate),
        markPrice: parseFloat(response.data.markPrice),
        indexPrice: parseFloat(response.data.indexPrice),
        nextFundingTime: parseInt(response.data.nextFundingTime),
        estimatedSettlePrice: parseFloat(response.data.estimatedSettlePrice || 0)
      };

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
      
    } catch (error) {
      logger.error(`Error fetching funding rate for ${symbol}: ${error.message}`);
      return null;
    }
  }

  async getOpenInterest(symbol) {
    try {
      const cacheKey = this.getCacheKey(symbol, 'oi');
      const cached = this.cache.get(cacheKey);
      
      if (this.isValidCacheEntry(cached)) {
        return cached.data;
      }

      const futuresSymbol = symbol.replace('/', '');
      
      const response = await axios.get(`${this.baseURL}/fapi/v1/openInterest`, {
        params: { symbol: futuresSymbol },
        timeout: 10000
      });
      
      const data = {
        symbol: symbol,
        openInterest: parseFloat(response.data.openInterest),
        openInterestValue: parseFloat(response.data.openInterestValue || 0)
      };

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
      
    } catch (error) {
      logger.error(`Error fetching open interest for ${symbol}: ${error.message}`);
      return null;
    }
  }

  async getLiquidationData(symbol) {
    try {
      if (!config.features.liquidationAnalysis) return null;
      
      const cacheKey = this.getCacheKey(symbol, 'liquidations');
      const cached = this.cache.get(cacheKey);
      
      if (this.isValidCacheEntry(cached)) {
        return cached.data;
      }

      const futuresSymbol = symbol.replace('/', '');
      
      const response = await axios.get(`${this.baseURL}/fapi/v1/forceOrders`, {
        params: { 
          symbol: futuresSymbol,
          limit: 50
        },
        timeout: 10000
      });
      
      const liquidations = response.data;
      let longLiquidations = 0;
      let shortLiquidations = 0;
      let totalLiquidated = 0;
      let totalValue = 0;
      
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      liquidations.forEach(liq => {
        if (parseInt(liq.time) > oneHourAgo) {
          const quantity = parseFloat(liq.origQty);
          const value = parseFloat(liq.price) * quantity;
          
          totalLiquidated += quantity;
          totalValue += value;
          
          if (liq.side === 'SELL') {
            longLiquidations += quantity;
          } else {
            shortLiquidations += quantity;
          }
        }
      });
      
      const data = {
        symbol: symbol,
        longLiquidations,
        shortLiquidations,
        totalLiquidated,
        totalValue,
        liquidationRatio: totalLiquidated > 0 ? longLiquidations / totalLiquidated : 0.5,
        timestamp: Date.now()
      };

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
      
    } catch (error) {
      logger.error(`Error fetching liquidation data for ${symbol}: ${error.message}`);
      return null;
    }
  }

  async getFundingHistory(symbol, limit = 10) {
    try {
      const futuresSymbol = symbol.replace('/', '');
      
      const response = await axios.get(`${this.baseURL}/fapi/v1/fundingRate`, {
        params: { 
          symbol: futuresSymbol,
          limit: limit
        },
        timeout: 10000
      });
      
      return response.data.map(rate => ({
        fundingTime: parseInt(rate.fundingTime),
        fundingRate: parseFloat(rate.fundingRate),
        markPrice: parseFloat(rate.markPrice)
      }));
      
    } catch (error) {
      logger.error(`Error fetching funding history for ${symbol}: ${error.message}`);
      return [];
    }
  }

  clearCache() {
    this.cache.clear();
    logger.info('Funding rate service cache cleared');
  }
}

module.exports = new FundingRateService();
