const config = require('../config/config');
const logger = require('../utils/logger');

class RiskManagement {
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

  calculateVolatility(closes, period = 20) {
    try {
      if (closes.length < period) return null;
      
      const recentCloses = closes.slice(-period);
      const mean = recentCloses.reduce((sum, price) => sum + price, 0) / period;
      
      const variance = recentCloses
        .reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      
      return Math.sqrt(variance) / mean;
    } catch (error) {
      logger.error(`Volatility calculation error: ${error.message}`);
      return null;
    }
  }

  calculateSupportResistance(ohlcv, lookback = 25) {
    try {
      if (ohlcv.length < lookback) return null;
      
      const recent = ohlcv.slice(-lookback);
      const highs = recent.map(candle => candle.high);
      const lows = recent.map(candle => candle.low);
      
      // Find pivot points
      const resistance = [];
      const support = [];
      
      for (let i = 2; i < recent.length - 2; i++) {
        const current = recent[i];
        const prev2 = recent[i - 2];
        const prev1 = recent[i - 1];
        const next1 = recent[i + 1];
        const next2 = recent[i + 2];
        
        // Resistance (local high)
        if (current.high > prev2.high && 
            current.high > prev1.high && 
            current.high > next1.high && 
            current.high > next2.high) {
          resistance.push(current.high);
        }
        
        // Support (local low)
        if (current.low < prev2.low && 
            current.low < prev1.low && 
            current.low < next1.low && 
            current.low < next2.low) {
          support.push(current.low);
        }
      }
      
      return {
        resistance: resistance.sort((a, b) => b - a).slice(0, 5),
        support: support.sort((a, b) => a - b).slice(0, 5),
        highestHigh: Math.max(...highs),
        lowestLow: Math.min(...lows),
        range: Math.max(...highs) - Math.min(...lows)
      };
    } catch (error) {
      logger.error(`Support/Resistance calculation error: ${error.message}`);
      return null;
    }
  }

  calculateEntryPrice(currentPrice, signal, indicators, atr) {
    try {
      const direction = signal.direction;
      const confidence = signal.confidence;
      
      // More aggressive entry for high confidence signals
      const atrMultiplier = confidence === 'HIGH' ? 0.15 : 0.3;
      const adjustment = atr * atrMultiplier;
      
      let entryPrice;
      
      if (direction === 'LONG') {
        entryPrice = currentPrice - adjustment;
        
        // Don't go below key support levels
        if (indicators.trend?.supertrend?.value && 
            indicators.trend.supertrend.trend === 1 && 
            entryPrice < indicators.trend.supertrend.value) {
          entryPrice = indicators.trend.supertrend.value * 1.001;
        }
        
        // Check VWAP support
        if (indicators.volume?.vwap && entryPrice < indicators.volume.vwap * 0.998) {
          entryPrice = indicators.volume.vwap * 0.999;
        }
        
      } else {
        entryPrice = currentPrice + adjustment;
        
        // Don't go above key resistance levels
        if (indicators.trend?.supertrend?.value && 
            indicators.trend.supertrend.trend === -1 && 
            entryPrice > indicators.trend.supertrend.value) {
          entryPrice = indicators.trend.supertrend.value * 0.999;
        }
        
        // Check VWAP resistance
        if (indicators.volume?.vwap && entryPrice > indicators.volume.vwap * 1.002) {
          entryPrice = indicators.volume.vwap * 1.001;
        }
      }
      
      return entryPrice;
    } catch (error) {
      logger.error(`Entry price calculation error: ${error.message}`);
      return currentPrice;
    }
  }

  calculateTakeProfitLevels(entryPrice, signal, indicators, atr, supportResistance) {
    try {
      const direction = signal.direction;
      const confidence = signal.confidence;
      
      const multipliers = config.riskManagement.takeProfitMultipliers[confidence.toLowerCase()];
      
      let tp1, tp2, tp3;
      
      if (direction === 'LONG') {
        tp1 = entryPrice + (atr * multipliers[0]);
        tp2 = entryPrice + (atr * multipliers[1]);
        tp3 = entryPrice + (atr * multipliers[2]);
        
        // Adjust based on resistance levels
        if (supportResistance && supportResistance.resistance.length > 0) {
          for (const resistance of supportResistance.resistance) {
            if (resistance > entryPrice) {
              if (tp1 > resistance * 0.995) {
                tp1 = resistance * 0.995;
              }
              if (tp2 > resistance * 0.99 && tp2 < resistance * 1.1) {
                tp2 = resistance * 0.99;
              }
              break;
            }
          }
        }
        
        // Check against trend indicators
        if (indicators.trend?.supertrend?.upperBand && tp2 > indicators.trend.supertrend.upperBand) {
          tp2 = indicators.trend.supertrend.upperBand * 0.99;
        }
        
      } else {
        tp1 = entryPrice - (atr * multipliers[0]);
        tp2 = entryPrice - (atr * multipliers[1]);
        tp3 = entryPrice - (atr * multipliers[2]);
        
        // Adjust based on support levels
        if (supportResistance && supportResistance.support.length > 0) {
          for (const support of supportResistance.support) {
            if (support < entryPrice) {
              if (tp1 < support * 1.005) {
                tp1 = support * 1.005;
              }
              if (tp2 < support * 1.01 && tp2 > support * 0.9) {
                tp2 = support * 1.01;
              }
              break;
            }
          }
        }
        
        // Check against trend indicators
        if (indicators.trend?.supertrend?.lowerBand && tp2 < indicators.trend.supertrend.lowerBand) {
          tp2 = indicators.trend.supertrend.lowerBand * 1.01;
        }
      }
      
      return { tp1, tp2, tp3 };
    } catch (error) {
      logger.error(`Take profit calculation error: ${error.message}`);
      return null;
    }
  }

  calculateStopLoss(entryPrice, signal, indicators, atr, supportResistance) {
    try {
      const direction = signal.direction;
      const confidence = signal.confidence;
      
      const slMultiplier = config.riskManagement.stopLossMultipliers[confidence.toLowerCase()];
      
      let stopLoss;
      
      if (direction === 'LONG') {
        stopLoss = entryPrice - (atr * slMultiplier);
        
        // Use Supertrend as dynamic SL
        if (indicators.trend?.supertrend?.value && 
            indicators.trend.supertrend.trend === 1 && 
            stopLoss > indicators.trend.supertrend.value) {
          stopLoss = indicators.trend.supertrend.value * 0.998;
        }
        
        // Use nearest support
        if (supportResistance && supportResistance.support.length > 0) {
          const nearestSupport = supportResistance.support.find(s => s < entryPrice);
          if (nearestSupport && stopLoss > nearestSupport * 0.995) {
            stopLoss = nearestSupport * 0.995;
          }
        }
        
        // Use EMA as support
        if (indicators.trend?.ema21 && stopLoss > indicators.trend.ema21 * 0.99) {
          stopLoss = indicators.trend.ema21 * 0.99;
        }
        
      } else {
        stopLoss = entryPrice + (atr * slMultiplier);
        
        // Use Supertrend as dynamic SL
        if (indicators.trend?.supertrend?.value && 
            indicators.trend.supertrend.trend === -1 && 
            stopLoss < indicators.trend.supertrend.value) {
          stopLoss = indicators.trend.supertrend.value * 1.002;
        }
        
        // Use nearest resistance
        if (supportResistance && supportResistance.resistance.length > 0) {
          const nearestResistance = supportResistance.resistance.find(r => r > entryPrice);
          if (nearestResistance && stopLoss < nearestResistance * 1.005) {
            stopLoss = nearestResistance * 1.005;
          }
        }
        
        // Use EMA as resistance
        if (indicators.trend?.ema21 && stopLoss < indicators.trend.ema21 * 1.01) {
          stopLoss = indicators.trend.ema21 * 1.01;
        }
      }
      
      return stopLoss;
    } catch (error) {
      logger.error(`Stop loss calculation error: ${error.message}`);
      return null;
    }
  }

  calculateRiskReward(entryPrice, stopLoss, takeProfits) {
    try {
      const risk = Math.abs(entryPrice - stopLoss);
      const rewards = takeProfits.map(tp => Math.abs(tp - entryPrice));
      
      return rewards.map(reward => reward / risk);
    } catch (error) {
      logger.error(`Risk/Reward calculation error: ${error.message}`);
      return null;
    }
  }

  calculatePositionSize(accountBalance, riskPercentage, entryPrice, stopLoss, maxLeverage = 10) {
    try {
      const riskAmount = accountBalance * (riskPercentage / 100);
      const priceRisk = Math.abs(entryPrice - stopLoss);
      const priceRiskPercentage = priceRisk / entryPrice;
      
      // Calculate position size without leverage
      const basePositionSize = riskAmount / priceRisk;
      
      // Calculate optimal leverage
      const optimalLeverage = Math.min(
        Math.max(1, Math.floor(1 / priceRiskPercentage)),
        maxLeverage
      );
      
      const leveragedPositionSize = basePositionSize * optimalLeverage;
      const margin = leveragedPositionSize * entryPrice / optimalLeverage;
      
      return {
        positionSize: leveragedPositionSize,
        basePositionSize: basePositionSize,
        margin: margin,
        leverage: optimalLeverage,
        riskAmount,
        riskPercentage,
        priceRiskPercentage: priceRiskPercentage * 100
      };
    } catch (error) {
      logger.error(`Position size calculation error: ${error.message}`);
      return null;
    }
  }

  calculateLiquidationPrice(entryPrice, leverage, direction) {
    try {
      // Simplified liquidation calculation (assuming 100% margin ratio)
      const liquidationDistance = 1 / leverage * 0.9; // 90% of max to account for fees
      
      if (direction === 'LONG') {
        return entryPrice * (1 - liquidationDistance);
      } else {
        return entryPrice * (1 + liquidationDistance);
      }
    } catch (error) {
      logger.error(`Liquidation price calculation error: ${error.message}`);
      return null;
    }
  }

  validateRiskParameters(entryPrice, stopLoss, takeProfits, positionInfo) {
    try {
      const warnings = [];
      
      // Check if stop loss is too tight
      const riskPercentage = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
      if (riskPercentage < 0.5) {
        warnings.push('Stop loss is very tight (<0.5%)');
      }
      if (riskPercentage > 5) {
        warnings.push('Stop loss is very wide (>5%)');
      }
      
      // Check risk/reward ratios
      const riskRewards = this.calculateRiskReward(entryPrice, stopLoss, [takeProfits.tp1, takeProfits.tp2, takeProfits.tp3]);
      if (riskRewards && riskRewards[0] < 1.5) {
        warnings.push('Poor risk/reward ratio for TP1');
      }
      
      // Check leverage
      if (positionInfo && positionInfo.leverage > 20) {
        warnings.push('Very high leverage (>20x)');
      }
      
      // Check liquidation distance
      if (positionInfo && positionInfo.leverage > 1) {
        const liqPrice = this.calculateLiquidationPrice(entryPrice, positionInfo.leverage, 'LONG');
        if (liqPrice && Math.abs(entryPrice - liqPrice) / entryPrice < 0.1) {
          warnings.push('Liquidation price too close to entry');
        }
      }
      
      return {
        isValid: warnings.length === 0,
        warnings: warnings,
        riskLevel: this.calculateRiskLevel(riskPercentage, positionInfo?.leverage || 1, riskRewards?.[0] || 1)
      };
    } catch (error) {
      logger.error(`Risk validation error: ${error.message}`);
      return { isValid: false, warnings: ['Risk validation failed'], riskLevel: 'HIGH' };
    }
  }

  calculateRiskLevel(riskPercentage, leverage, riskReward) {
    try {
      let score = 0;
      
      // Risk percentage score
      if (riskPercentage < 1) score += 1;
      else if (riskPercentage < 2) score += 2;
      else if (riskPercentage < 3) score += 3;
      else score += 4;
      
      // Leverage score
      if (leverage <= 3) score += 1;
      else if (leverage <= 5) score += 2;
      else if (leverage <= 10) score += 3;
      else score += 4;
      
      // Risk/reward score
      if (riskReward >= 3) score += 1;
      else if (riskReward >= 2) score += 2;
      else if (riskReward >= 1.5) score += 3;
      else score += 4;
      
      if (score <= 4) return 'LOW';
      if (score <= 7) return 'MEDIUM';
      if (score <= 10) return 'HIGH';
      return 'EXTREME';
    } catch (error) {
      logger.error(`Risk level calculation error: ${error.message}`);
      return 'HIGH';
    }
  }
}

module.exports = new RiskManagement();
