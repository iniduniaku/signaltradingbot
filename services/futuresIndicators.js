const config = require('../config/config');
const logger = require('../utils/logger');

class FuturesIndicators {
  calculateEMA(values, period) {
    try {
      if (values.length < period) return null;
      
      const multiplier = 2 / (period + 1);
      let ema = values[0];
      
      for (let i = 1; i < values.length; i++) {
        ema = (values[i] * multiplier) + (ema * (1 - multiplier));
      }
      
      return ema;
    } catch (error) {
      logger.error(`EMA calculation error: ${error.message}`);
      return null;
    }
  }

  calculateEMAArray(values, period) {
    try {
      if (values.length < period) return [];
      
      const multiplier = 2 / (period + 1);
      const emaArray = [values[0]];
      
      for (let i = 1; i < values.length; i++) {
        const ema = (values[i] * multiplier) + (emaArray[i - 1] * (1 - multiplier));
        emaArray.push(ema);
      }
      
      return emaArray;
    } catch (error) {
      logger.error(`EMA Array calculation error: ${error.message}`);
      return [];
    }
  }

  calculateVWAP(ohlcv) {
    try {
      if (ohlcv.length < 20) return null;
      
      let totalVolume = 0;
      let totalVolumePrice = 0;
      
      for (const candle of ohlcv) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        totalVolumePrice += typicalPrice * candle.volume;
        totalVolume += candle.volume;
      }
      
      return totalVolume > 0 ? totalVolumePrice / totalVolume : null;
    } catch (error) {
      logger.error(`VWAP calculation error: ${error.message}`);
      return null;
    }
  }

  calculateATR(ohlcv, period = 14) {
    try {
      if (ohlcv.length < period + 1) return null;
      
      const trueRanges = [];
      for (let i = 1; i < ohlcv.length; i++) {
        const high = ohlcv[i].high;
        const low = ohlcv[i].low;
        const prevClose = ohlcv[i - 1].close;
        
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }
      
      return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
    } catch (error) {
      logger.error(`ATR calculation error: ${error.message}`);
      return null;
    }
  }

  calculateSupertrend(ohlcv, period = 10, multiplier = 3) {
    try {
      if (ohlcv.length < period + 10) return null;
      
      const atr = this.calculateATRArray(ohlcv, period);
      if (atr.length === 0) return null;
      
      let upperBand, lowerBand, supertrend, trend = 1;
      
      for (let i = period; i < ohlcv.length; i++) {
        const hl2 = (ohlcv[i].high + ohlcv[i].low) / 2;
        const currentATR = atr[i - 1];
        
        const newUpperBand = hl2 + (multiplier * currentATR);
        const newLowerBand = hl2 - (multiplier * currentATR);
        
        // Basic supertrend logic
        upperBand = newUpperBand < upperBand || ohlcv[i - 1].close > upperBand ? newUpperBand : upperBand;
        lowerBand = newLowerBand > lowerBand || ohlcv[i - 1].close < lowerBand ? newLowerBand : lowerBand;
        
        if (ohlcv[i].close <= lowerBand) {
          trend = -1;
          supertrend = upperBand;
        } else if (ohlcv[i].close >= upperBand) {
          trend = 1;
          supertrend = lowerBand;
        } else {
          supertrend = trend === 1 ? lowerBand : upperBand;
        }
      }
      
      return {
        value: supertrend,
        trend: trend,
        upperBand: upperBand,
        lowerBand: lowerBand
      };
    } catch (error) {
      logger.error(`Supertrend calculation error: ${error.message}`);
      return null;
    }
  }

  calculateATRArray(ohlcv, period = 14) {
    try {
      const trueRanges = [];
      
      for (let i = 1; i < ohlcv.length; i++) {
        const high = ohlcv[i].high;
        const low = ohlcv[i].low;
        const prevClose = ohlcv[i - 1].close;
        
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }
      
      const atr = [];
      for (let i = period - 1; i < trueRanges.length; i++) {
        const sum = trueRanges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        atr.push(sum / period);
      }
      
      return atr;
    } catch (error) {
      logger.error(`ATR Array calculation error: ${error.message}`);
      return [];
    }
  }

  calculateMFI(ohlcv, period = 14) {
    try {
      if (ohlcv.length < period + 1) return null;
      
      const moneyFlows = [];
      
      for (let i = 1; i < ohlcv.length; i++) {
        const current = ohlcv[i];
        const previous = ohlcv[i - 1];
        
        const typicalPrice = (current.high + current.low + current.close) / 3;
        const prevTypicalPrice = (previous.high + previous.low + previous.close) / 3;
        
        const rawMoneyFlow = typicalPrice * current.volume;
        const direction = typicalPrice > prevTypicalPrice ? 1 : -1;
        
        moneyFlows.push({
          value: rawMoneyFlow,
          direction: direction
        });
      }
      
      if (moneyFlows.length < period) return null;
      
      const recentFlows = moneyFlows.slice(-period);
      let positiveFlow = 0;
      let negativeFlow = 0;
      
      recentFlows.forEach(flow => {
        if (flow.direction === 1) {
          positiveFlow += flow.value;
        } else {
          negativeFlow += flow.value;
        }
      });
      
      if (negativeFlow === 0) return 100;
      
      const moneyRatio = positiveFlow / negativeFlow;
      const mfi = 100 - (100 / (1 + moneyRatio));
      
      return mfi;
    } catch (error) {
      logger.error(`MFI calculation error: ${error.message}`);
      return null;
    }
  }

  calculateOBV(ohlcv) {
    try {
      if (ohlcv.length < 2) return null;
      
      let obv = 0;
      
      for (let i = 1; i < ohlcv.length; i++) {
        const current = ohlcv[i];
        const previous = ohlcv[i - 1];
        
        if (current.close > previous.close) {
          obv += current.volume;
        } else if (current.close < previous.close) {
          obv -= current.volume;
        }
      }
      
      return obv;
    } catch (error) {
      logger.error(`OBV calculation error: ${error.message}`);
      return null;
    }
  }

  calculateWilliamsR(ohlcv, period = 14) {
    try {
      if (ohlcv.length < period) return null;
      
      const recent = ohlcv.slice(-period);
      const highest = Math.max(...recent.map(c => c.high));
      const lowest = Math.min(...recent.map(c => c.low));
      const currentClose = ohlcv[ohlcv.length - 1].close;
      
      if (highest === lowest) return 0;
      
      const williamsR = ((highest - currentClose) / (highest - lowest)) * -100;
      
      return williamsR;
    } catch (error) {
      logger.error(`Williams %R calculation error: ${error.message}`);
      return null;
    }
  }

  calculateCCI(ohlcv, period = 20) {
    try {
      if (ohlcv.length < period) return null;
      
      const typicalPrices = ohlcv.map(c => (c.high + c.low + c.close) / 3);
      const recent = typicalPrices.slice(-period);
      
      const sma = recent.reduce((sum, price) => sum + price, 0) / period;
      const meanDeviation = recent.reduce((sum, price) => sum + Math.abs(price - sma), 0) / period;
      
      if (meanDeviation === 0) return 0;
      
      const currentTypicalPrice = typicalPrices[typicalPrices.length - 1];
      const cci = (currentTypicalPrice - sma) / (0.015 * meanDeviation);
      
      return cci;
    } catch (error) {
      logger.error(`CCI calculation error: ${error.message}`);
      return null;
    }
  }

  calculateIchimoku(ohlcv) {
    try {
      if (ohlcv.length < 52) return null;
      
      // Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
      const tenkanHigh = Math.max(...ohlcv.slice(-9).map(c => c.high));
      const tenkanLow = Math.min(...ohlcv.slice(-9).map(c => c.low));
      const tenkanSen = (tenkanHigh + tenkanLow) / 2;
      
      // Kijun-sen (Base Line): (26-period high + 26-period low) / 2
      const kijunHigh = Math.max(...ohlcv.slice(-26).map(c => c.high));
      const kijunLow = Math.min(...ohlcv.slice(-26).map(c => c.low));
      const kijunSen = (kijunHigh + kijunLow) / 2;
      
      // Senkou Span A: (Tenkan-sen + Kijun-sen) / 2
      const senkouSpanA = (tenkanSen + kijunSen) / 2;
      
      // Senkou Span B: (52-period high + 52-period low) / 2
      const senkouHigh = Math.max(...ohlcv.slice(-52).map(c => c.high));
      const senkouLow = Math.min(...ohlcv.slice(-52).map(c => c.low));
      const senkouSpanB = (senkouHigh + senkouLow) / 2;
      
      // Chikou Span: Current close
      const chikouSpan = ohlcv[ohlcv.length - 1].close;
      
      return {
        tenkanSen,
        kijunSen,
        senkouSpanA,
        senkouSpanB,
        chikouSpan
      };
    } catch (error) {
      logger.error(`Ichimoku calculation error: ${error.message}`);
      return null;
    }
  }

  calculateMarketStructure(ohlcv, lookback = 20) {
    try {
      if (ohlcv.length < lookback) return null;
      
      const recent = ohlcv.slice(-lookback);
      let higherHighs = 0;
      let lowerLows = 0;
      let higherLows = 0;
      let lowerHighs = 0;
      
      for (let i = 1; i < recent.length; i++) {
        const current = recent[i];
        const previous = recent[i - 1];
        
        if (current.high > previous.high) higherHighs++;
        if (current.low < previous.low) lowerLows++;
        if (current.low > previous.low) higherLows++;
        if (current.high < previous.high) lowerHighs++;
      }
      
      const bullishStructure = higherHighs + higherLows;
      const bearishStructure = lowerLows + lowerHighs;
      
      return {
        trend: bullishStructure > bearishStructure ? 'BULLISH' : 'BEARISH',
        strength: Math.abs(bullishStructure - bearishStructure) / (lookback - 1),
        higherHighs,
        lowerLows,
        higherLows,
        lowerHighs
      };
    } catch (error) {
      logger.error(`Market structure calculation error: ${error.message}`);
      return null;
    }
  }
}

module.exports = new FuturesIndicators();
