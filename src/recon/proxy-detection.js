"use strict";

// Proxy Detection - Module for detecting blocks and recommending conservative operator actions.

class ProxyDetection {
  constructor() {
    // Signs of various types of blocking
    this.blockSigns = {
      httpStatus: {
        403: { type: 'forbidden', severity: 'high', message: 'Access forbidden' },
        429: { type: 'rate_limit', severity: 'medium', message: 'Rate limit exceeded' },
        503: { type: 'service_unavailable', severity: 'medium', message: 'Service unavailable' },
        502: { type: 'bad_gateway', severity: 'low', message: 'Bad gateway' },
        504: { type: 'gateway_timeout', severity: 'low', message: 'Gateway timeout' }
      },
      contentPatterns: [
        { pattern: /access denied/i, type: 'access_denied', severity: 'high', message: 'Access denied' },
        { pattern: /blocked/i, type: 'blocked', severity: 'high', message: 'IP blocked' },
        { pattern: /rate\s*limit/i, type: 'rate_limit', severity: 'medium', message: 'Rate limit detected' },
        { pattern: /too\s*many\s*requests/i, type: 'rate_limit', severity: 'medium', message: 'Too many requests' },
        { pattern: /please\s*solve\s*captcha/i, type: 'captcha', severity: 'high', message: 'CAPTCHA required' },
        { pattern: /cloudflare/i, type: 'cloudflare', severity: 'medium', message: 'Cloudflare protection' },
        { pattern: /ddos\s*protection/i, type: 'ddos_protection', severity: 'medium', message: 'DDoS protection active' },
        { pattern: /security\s*check/i, type: 'security_check', severity: 'medium', message: 'Security check' },
        { pattern: /verify\s*you\s*are\s*human/i, type: 'human_verification', severity: 'high', message: 'Human verification required' },
        { pattern: /bot\s*detected/i, type: 'bot_detection', severity: 'high', message: 'Bot detected' },
        { pattern: /automated\s*traffic/i, type: 'automated_traffic', severity: 'medium', message: 'Automated traffic detected' },
        { pattern: /connection\s*refused/i, type: 'connection_refused', severity: 'high', message: 'Connection refused' },
        { pattern: /timeout/i, type: 'timeout', severity: 'medium', message: 'Connection timeout' }
      ],
      headers: {
        'server': { pattern: /cloudflare/i, type: 'cloudflare', severity: 'medium' },
        'x-amzn-errortype': { pattern: /Throttled/i, type: 'rate_limit', severity: 'medium' },
        'x-rate-limit-remaining': { pattern: /^0$/, type: 'rate_limit', severity: 'medium' },
        'retry-after': { type: 'rate_limit', severity: 'medium' } // Any value indicates rate limit
      }
    };
  }

  /**
   * Detect if a response indicates blocking or restrictions
   * @param {Object} response - HTTP response object
   * @param {string} body - Response body content
   * @param {Object} options - Detection options
   * @returns {Object} Detection result with blocking info and suggested actions
   */
  detectBlockage(response, body = '', options = {}) {
    const {
      sensitivity = 'medium', // low, medium, high
      checkHeaders = true,
      checkContent = true,
      checkStatus = true
    } = options;

    const result = {
      isBlocked: false,
      severity: 'none', // none, low, medium, high
      confidence: 0, // 0-100
      type: null,
      message: '',
      details: {},
      suggestedActions: [],
      timestamp: new Date().toISOString()
    };

    let score = 0;
    const maxScore = 100;
    const details = {};

    // Check HTTP status code
    if (checkStatus && response.statusCode) {
      const statusSign = this.blockSigns.httpStatus[response.statusCode];
      if (statusSign) {
        score += 30;
        details.statusCode = {
          code: response.statusCode,
          type: statusSign.type,
          severity: statusSign.severity,
          message: statusSign.message
        };
        
        // If we have a definitive blocking status, we can be confident
        if ([403, 429].includes(response.statusCode)) {
          score += 40;
        }
      }
    }

    // Check headers for blocking signs
    if (checkHeaders && response.headers) {
      for (const [headerName, headerConfig] of Object.entries(this.blockSigns.headers)) {
        const headerValue = response.headers[headerName];
        if (!headerValue) continue;
        
        if (headerConfig.pattern) {
          if (typeof headerConfig.pattern === 'string') {
            if (headerValue.includes(headerConfig.pattern)) {
              score += 20;
              details[headerName] = {
                value: headerValue,
                type: headerConfig.type,
                severity: headerConfig.severity
              };
            }
          } else if (headerConfig.pattern instanceof RegExp) {
            if (headerConfig.pattern.test(headerValue)) {
              score += 20;
              details[headerName] = {
                value: headerValue,
                type: headerConfig.type,
                severity: headerConfig.severity
              };
            }
          }
        } else if (headerConfig.type) {
          // Header exists, so it's a sign
          score += 15;
          details[headerName] = {
            value: headerValue,
            type: headerConfig.type,
            severity: headerConfig.severity
          };
        }
      }
    }

    // Check content for blocking patterns
    if (checkContent && body && typeof body === 'string') {
      for (const patternObj of this.blockSigns.contentPatterns) {
        if (patternObj.pattern.test(body)) {
          score += 25;
          details.contentMatch = {
            pattern: patternObj.pattern.toString(),
            type: patternObj.type,
            severity: patternObj.severity,
            message: patternObj.message
          };
          
          // Some patterns are very definitive
          if (patternObj.type === 'access_denied' || patternObj.type === 'captcha') {
            score += 25;
          }
          break; // Only count first match to avoid over-scoring
        }
      }
    }

    // Apply sensitivity multiplier
    const sensitivityMultipliers = {
      low: 0.7,
      medium: 1.0,
      high: 1.3
    };
    
    score = Math.floor(score * (sensitivityMultipliers[sensitivity] || 1.0));
    score = Math.min(score, maxScore); // Cap at 100

    result.confidence = score;
    result.isBlocked = score >= 30; // Threshold for considering blocked
    
    // Determine severity based on score and details
    if (score >= 80) {
      result.severity = 'high';
    } else if (score >= 50) {
      result.severity = 'medium';
    } else if (score >= 30) {
      result.severity = 'low';
    } else {
      result.severity = 'none';
    }

    // Set type and message based on strongest indicator
    if (details.statusCode) {
      result.type = details.statusCode.type;
      result.message = details.statusCode.message;
    } else if (details.contentMatch) {
      result.type = details.contentMatch.type;
      result.message = details.contentMatch.message;
    } else {
      // Check headers for type
      for (const [key, value] of Object.entries(details)) {
        if (key !== 'statusCode' && key !== 'contentMatch' && value.type) {
          result.type = value.type;
          result.message = this._getMessageForType(value.type);
          break;
        }
      }
    }

    // Generate suggested actions
    result.suggestedActions = this._generateSuggestedActions(result, details);

    result.details = details;
    
    return result;
  }

  /**
   * Get human-readable message for block type
   * @private
   */
  _getMessageForType(type) {
    const messages = {
      'forbidden': 'Access forbidden (403)',
      'rate_limit': 'Rate limit exceeded (429)',
      'service_unavailable': 'Service unavailable (503)',
      'access_denied': 'Access denied',
      'blocked': 'IP address blocked',
      'captcha': 'CAPTCHA challenge required',
      'cloudflare': 'Cloudflare protection detected',
      'ddos_protection': 'DDoS protection active',
      'security_check': 'Security check in progress',
      'human_verification': 'Human verification required',
      'bot_detection': 'Bot traffic detected',
      'automated_traffic': 'Automated traffic detected',
      'connection_refused': 'Connection refused',
      'timeout': 'Connection timeout',
      'bad_gateway': 'Bad gateway (502)',
      'gateway_timeout': 'Gateway timeout (504)'
    };
    
    return messages[type] || 'Unknown blocking detected';
  }

  /**
   * Generate suggested actions based on block detection
   * @private
   */
  _generateSuggestedActions(detectionResult, details) {
    const actions = [];
    
    if (!detectionResult.isBlocked) {
      actions.push({
        action: 'continue',
        priority: 'low',
        description: 'No blocking detected, continue normal operations'
      });
      return actions;
    }

    // Based on severity and type, suggest appropriate actions
    switch (detectionResult.severity) {
      case 'high':
        if (detectionResult.type === 'captcha' || detectionResult.type === 'human_verification') {
          actions.push({
            action: 'pause_and_investigate',
            priority: 'high',
            description: 'Pause operations and investigate CAPTCHA/human verification challenge'
          });
        }
        
        if (detectionResult.type === 'access_denied' || detectionResult.type === 'blocked') {
          actions.push({
            action: 'review_scope_and_proxy',
            priority: 'high',
            description: 'Review scope, authorization, and configured proxy before continuing'
          });
        }
        break;
        
      case 'medium':
        if (detectionResult.type === 'rate_limit') {
          actions.push({
            action: 'reduce_rate',
            priority: 'medium',
            description: 'Reduce request rate to avoid further rate limiting'
          });
          
          actions.push({
            action: 'increase_delay',
            priority: 'medium',
            description: 'Increase delay between requests'
          });
        }
        break;
        
      case 'low':
        actions.push({
          action: 'monitor',
          priority: 'low',
          description: 'Monitor for increasing blocking signs'
        });
        break;
    }

    if (detectionResult.type === 'rate_limit' && !actions.some((action) => action.action === 'reduce_rate')) {
      actions.push({
        action: 'reduce_rate',
        priority: 'high',
        description: 'Reduce request rate before continuing'
      });
      actions.push({
        action: 'increase_delay',
        priority: 'medium',
        description: 'Increase delay between requests'
      });
    }

    // Add general recommendations
    actions.push({
      action: 'log_event',
      priority: 'low',
      description: 'Log blocking event for analysis and pattern recognition'
    });

    // Sort by priority (high -> medium -> low)
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    actions.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
    
    return actions;
  }
}

module.exports = ProxyDetection;
