/**
 * Jupiter API Client Service
 * 
 * Connects Exotel stack to Jupiter (Mangwale AI Backend)
 * ALL order/vendor/rider data comes from Jupiter via PHP backend
 * 
 * Architecture:
 *   Exotel Service → Jupiter (192.168.0.156:3200) → PHP Backend → Database
 * 
 * Exotel does NOT have its own database - it's a thin orchestration layer
 */

import axios from 'axios';
import NodeCache from 'node-cache';

// Jupiter API configuration
export const JUPITER_URL = process.env.JUPITER_URL || 'http://192.168.0.156:3200';
export const PHP_BACKEND_URL = process.env.PHP_BACKEND_URL || 'https://www.mangwale.com';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || 'exotel-service-key';

// Cache for frequently accessed data (TTL in seconds)
const cache = new NodeCache({
  stdTTL: 60,        // Default 1 minute cache
  checkperiod: 30,   // Check for expired keys every 30s
});

// Create HTTP clients
const jupiterClient = axios.create({
  baseURL: JUPITER_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'X-Service': 'exotel-service',
    'X-API-Key': JUPITER_API_KEY,
  },
});

const phpClient = axios.create({
  baseURL: PHP_BACKEND_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-localization': 'en',
  },
});

// ============================================================================
// ORDER DATA
// ============================================================================

/**
 * Get order details from Jupiter/PHP
 * @param {number} orderId - Order ID
 * @param {string} token - User auth token (optional, for authenticated requests)
 */
export async function getOrderDetails(orderId, token = null) {
  const cacheKey = `order:${orderId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Try Jupiter first (may have enhanced data)
    const response = await jupiterClient.get(`/api/order/${orderId}`);
    cache.set(cacheKey, response.data, 30); // 30 second cache for orders
    return response.data;
  } catch (err) {
    console.log(`Jupiter order fetch failed, trying PHP: ${err.message}`);
  }

  // Fallback to PHP backend directly
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await phpClient.get('/api/v1/customer/order/details', {
      params: { order_id: orderId },
      headers,
    });

    const order = transformPhpOrder(response.data);
    cache.set(cacheKey, order, 30);
    return order;
  } catch (err) {
    console.error(`Failed to get order ${orderId}:`, err.message);
    return null;
  }
}

/**
 * Get running/active orders for a user
 * @param {string} phone - User phone number
 * @param {string} token - User auth token
 */
export async function getActiveOrders(phone, token = null) {
  try {
    // Try Jupiter first
    const response = await jupiterClient.get(`/api/order/active`, {
      params: { phone },
    });
    return response.data?.orders || [];
  } catch (err) {
    console.log(`Jupiter active orders failed: ${err.message}`);
  }

  // Fallback to PHP
  if (token) {
    try {
      const response = await phpClient.get('/api/v1/customer/order/running-orders', {
        params: { limit: 10, offset: 0 },
        headers: { Authorization: `Bearer ${token}` },
      });
      return (response.data || []).map(transformPhpOrder);
    } catch (err) {
      console.error(`PHP active orders failed: ${err.message}`);
    }
  }

  return [];
}

/**
 * Get order (alias for getOrderDetails for compatibility)
 * @param {number} orderId - Order ID
 */
export async function getOrder(orderId) {
  return getOrderDetails(orderId);
}

/**
 * Update order notes via Jupiter/PHP
 * @param {number} orderId - Order ID
 * @param {object} notes - Notes to add to order
 */
export async function updateOrderNotes(orderId, notes) {
  try {
    const response = await jupiterClient.post(`/api/order/${orderId}/notes`, {
      notes,
      source: 'exotel-service',
      timestamp: new Date().toISOString()
    });
    return response.data;
  } catch (err) {
    console.log(`Jupiter update notes failed, trying PHP: ${err.message}`);
  }

  // Fallback to PHP backend
  try {
    const response = await phpClient.post('/api/v1/admin/order/update-note', {
      order_id: orderId,
      order_note: typeof notes === 'string' ? notes : JSON.stringify(notes)
    });
    return response.data;
  } catch (err) {
    console.error(`Failed to update order notes ${orderId}:`, err.message);
    throw err;
  }
}

/**
 * Track order location
 * @param {number} orderId - Order ID
 */
export async function trackOrder(orderId) {
  try {
    const response = await phpClient.get('/api/v1/customer/order/track', {
      params: { order_id: orderId },
    });

    return {
      success: true,
      status: response.data?.order_status,
      location: response.data?.delivery_man_location ? {
        latitude: parseFloat(response.data.delivery_man_location.latitude),
        longitude: parseFloat(response.data.delivery_man_location.longitude),
      } : null,
      deliveryMan: response.data?.delivery_man ? {
        name: response.data.delivery_man.f_name,
        phone: response.data.delivery_man.phone,
        image: response.data.delivery_man.image,
      } : null,
    };
  } catch (err) {
    console.error(`Track order ${orderId} failed:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Transform PHP order to standard format
 */
export function transformPhpOrder(phpOrder) {
  if (!phpOrder) return null;

  return {
    id: phpOrder.id,
    orderId: phpOrder.id,
    status: phpOrder.order_status,
    amount: parseFloat(phpOrder.order_amount || 0),
    deliveryCharge: parseFloat(phpOrder.delivery_charge || 0),
    paymentMethod: phpOrder.payment_method,
    paymentStatus: phpOrder.payment_status,
    orderNote: phpOrder.order_note,
    createdAt: phpOrder.created_at,
    
    // Customer info
    customer: {
      id: phpOrder.user_id,
      name: phpOrder.customer?.f_name || 'Customer',
      phone: phpOrder.customer?.phone,
    },
    
    // Store/Vendor info
    store: phpOrder.store ? {
      id: phpOrder.store.id,
      name: phpOrder.store.name,
      phone: phpOrder.store.phone,
      address: phpOrder.store.address,
    } : null,
    
    // Delivery man info
    deliveryMan: phpOrder.delivery_man ? {
      id: phpOrder.delivery_man.id,
      name: `${phpOrder.delivery_man.f_name || ''} ${phpOrder.delivery_man.l_name || ''}`.trim(),
      phone: phpOrder.delivery_man.phone,
      image: phpOrder.delivery_man.image,
    } : null,
    
    // Addresses
    pickupAddress: phpOrder.sender_details ? 
      (typeof phpOrder.sender_details === 'string' ? JSON.parse(phpOrder.sender_details) : phpOrder.sender_details) 
      : null,
    deliveryAddress: phpOrder.receiver_details ? 
      (typeof phpOrder.receiver_details === 'string' ? JSON.parse(phpOrder.receiver_details) : phpOrder.receiver_details) 
      : null,
    
    // Items
    items: phpOrder.details?.map(d => ({
      name: d.food?.name || d.product_details?.name || 'Item',
      quantity: d.quantity,
      price: parseFloat(d.price || 0),
    })) || [],
  };
}

// ============================================================================
// STORE/VENDOR DATA
// ============================================================================

/**
 * Get store/vendor details
 * @param {number} storeId - Store ID
 */
export async function getStoreDetails(storeId) {
  const cacheKey = `store:${storeId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await phpClient.get(`/api/v1/stores/details/${storeId}`);
    
    const store = {
      id: response.data.id,
      name: response.data.name,
      phone: response.data.phone,
      email: response.data.email,
      address: response.data.address,
      latitude: response.data.latitude,
      longitude: response.data.longitude,
      logo: response.data.logo,
      coverPhoto: response.data.cover_photo,
      rating: response.data.avg_rating,
      deliveryTime: response.data.delivery_time,
      minimumOrder: response.data.minimum_order,
      isOpen: response.data.active === 1,
    };

    cache.set(cacheKey, store, 300); // 5 minute cache for store info
    return store;
  } catch (err) {
    console.error(`Get store ${storeId} failed:`, err.message);
    return null;
  }
}

/**
 * Get store by phone number (for vendor callbacks)
 * @param {string} phone - Store phone number
 */
export async function getStoreByPhone(phone) {
  const cacheKey = `store:phone:${phone}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Search stores by phone
    const response = await phpClient.get('/api/v1/stores/search', {
      params: { phone: phone },
    });

    if (response.data && response.data.length > 0) {
      const store = {
        id: response.data[0].id,
        name: response.data[0].name,
        phone: response.data[0].phone,
        address: response.data[0].address,
      };
      cache.set(cacheKey, store, 300);
      return store;
    }

    return null;
  } catch (err) {
    console.error(`Get store by phone ${phone} failed:`, err.message);
    return null;
  }
}

/**
 * Get orders pending for a store/vendor
 * @param {number} storeId - Store ID
 * @param {string} vendorToken - Vendor auth token
 */
export async function getVendorPendingOrders(storeId, vendorToken = null) {
  try {
    // Jupiter may have vendor-specific endpoints
    const response = await jupiterClient.get(`/api/vendor/orders/pending`, {
      params: { store_id: storeId },
    });
    return response.data?.orders || [];
  } catch (err) {
    console.log(`Jupiter vendor orders failed: ${err.message}`);
  }

  // Fallback - would need vendor panel API access
  return [];
}

// ============================================================================
// DELIVERY MAN / RIDER DATA
// ============================================================================

/**
 * Get delivery man details
 * @param {number} deliveryManId - Delivery man ID
 */
export async function getDeliveryManDetails(deliveryManId) {
  const cacheKey = `dm:${deliveryManId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await phpClient.get(`/api/v1/delivery-man/details/${deliveryManId}`);
    
    const dm = {
      id: response.data.id,
      name: `${response.data.f_name || ''} ${response.data.l_name || ''}`.trim(),
      phone: response.data.phone,
      email: response.data.email,
      image: response.data.image,
      rating: response.data.avg_rating,
      vehicleType: response.data.vehicle_type,
      currentOrders: response.data.current_orders || 0,
      isActive: response.data.active === 1,
    };

    cache.set(cacheKey, dm, 120); // 2 minute cache for rider info
    return dm;
  } catch (err) {
    console.error(`Get delivery man ${deliveryManId} failed:`, err.message);
    return null;
  }
}

/**
 * Get delivery man by phone number (for rider callbacks)
 * @param {string} phone - Rider phone number
 */
export async function getDeliveryManByPhone(phone) {
  const cacheKey = `dm:phone:${phone}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // This would need a search endpoint on PHP backend
    const response = await phpClient.get('/api/v1/delivery-man/search', {
      params: { phone: phone },
    });

    if (response.data && response.data.length > 0) {
      const dm = {
        id: response.data[0].id,
        name: `${response.data[0].f_name || ''} ${response.data[0].l_name || ''}`.trim(),
        phone: response.data[0].phone,
      };
      cache.set(cacheKey, dm, 120);
      return dm;
    }

    return null;
  } catch (err) {
    // May not have direct search - try Jupiter
    try {
      const jupiterResponse = await jupiterClient.get('/api/rider/lookup', {
        params: { phone },
      });
      if (jupiterResponse.data) {
        cache.set(cacheKey, jupiterResponse.data, 120);
        return jupiterResponse.data;
      }
    } catch (jupiterErr) {
      console.error(`Jupiter rider lookup failed: ${jupiterErr.message}`);
    }

    return null;
  }
}

/**
 * Get rider's assigned orders
 * @param {number} deliveryManId - Delivery man ID
 * @param {string} riderToken - Rider auth token
 */
export async function getRiderAssignedOrders(deliveryManId, riderToken = null) {
  try {
    // Jupiter endpoint for rider orders
    const response = await jupiterClient.get(`/api/rider/orders`, {
      params: { delivery_man_id: deliveryManId },
    });
    return response.data?.orders || [];
  } catch (err) {
    console.log(`Jupiter rider orders failed: ${err.message}`);
  }

  return [];
}

// ============================================================================
// CUSTOMER DATA
// ============================================================================

/**
 * Get customer details by phone
 * @param {string} phone - Customer phone number
 */
export async function getCustomerByPhone(phone) {
  const cacheKey = `customer:phone:${phone}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Try Jupiter first (has session/conversation context)
    const response = await jupiterClient.get('/api/customer/lookup', {
      params: { phone },
    });

    if (response.data) {
      cache.set(cacheKey, response.data, 60);
      return response.data;
    }
  } catch (err) {
    console.log(`Jupiter customer lookup failed: ${err.message}`);
  }

  // Minimal customer data from phone
  return {
    phone: phone,
    name: null,
    isRegistered: false,
  };
}

/**
 * Get customer's recent orders
 * @param {string} phone - Customer phone number
 * @param {string} token - Customer auth token
 * @param {number} limit - Number of orders to fetch
 */
export async function getCustomerOrders(phone, token = null, limit = 5) {
  if (!token) {
    // Without token, can only get from Jupiter's session
    try {
      const response = await jupiterClient.get('/api/customer/orders', {
        params: { phone, limit },
      });
      return response.data?.orders || [];
    } catch (err) {
      return [];
    }
  }

  try {
    const response = await phpClient.get('/api/v1/customer/order/list', {
      params: { limit, offset: 0 },
      headers: { Authorization: `Bearer ${token}` },
    });
    return (response.data || []).map(transformPhpOrder);
  } catch (err) {
    console.error(`Get customer orders failed:`, err.message);
    return [];
  }
}

// ============================================================================
// EVENT NOTIFICATIONS (to Jupiter)
// ============================================================================

/**
 * Notify Jupiter about IVR events
 * @param {string} eventType - Event type (call_started, dtmf_received, etc.)
 * @param {object} eventData - Event data
 */
export async function notifyJupiter(eventType, eventData) {
  try {
    await jupiterClient.post('/api/notifications/ivr-event', {
      type: eventType,
      data: eventData,
      source: 'exotel-service',
      timestamp: new Date().toISOString(),
    });
    console.log(`✅ Notified Jupiter: ${eventType}`);
    return true;
  } catch (err) {
    console.error(`Failed to notify Jupiter: ${err.message}`);
    return false;
  }
}

/**
 * Request order status update from Jupiter
 * @param {number} orderId - Order ID  
 * @param {string} newStatus - New status
 * @param {object} metadata - Additional metadata
 */
export async function updateOrderStatus(orderId, newStatus, metadata = {}) {
  try {
    const response = await jupiterClient.post('/api/order/status', {
      orderId,
      status: newStatus,
      metadata,
      source: 'exotel-ivr',
    });

    // Invalidate order cache
    cache.del(`order:${orderId}`);
    
    return { success: true, data: response.data };
  } catch (err) {
    console.error(`Failed to update order status: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Send notification request to Jupiter
 * @param {object} notification - Notification details
 */
export async function sendNotification(notification) {
  try {
    const response = await jupiterClient.post('/api/notifications/send', notification);
    return { success: true, jobId: response.data?.jobId };
  } catch (err) {
    console.error(`Send notification failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// HEALTH & STATUS
// ============================================================================

/**
 * Check Jupiter connectivity
 */
export async function checkJupiterHealth() {
  try {
    const start = Date.now();
    const response = await jupiterClient.get('/health', { timeout: 5000 });
    return {
      connected: true,
      latency: Date.now() - start,
      status: response.data?.status || 'unknown',
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
    };
  }
}

/**
 * Check PHP backend connectivity
 */
export async function checkPhpHealth() {
  try {
    const start = Date.now();
    await phpClient.get('/', { timeout: 5000 });
    return {
      connected: true,
      latency: Date.now() - start,
    };
  } catch (err) {
    // Even 404 means connected
    if (err.response) {
      return { connected: true, latency: 0 };
    }
    return {
      connected: false,
      error: err.message,
    };
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return cache.getStats();
}

/**
 * Clear cache
 */
export function clearCache(prefix = null) {
  if (prefix) {
    const keys = cache.keys().filter(k => k.startsWith(prefix));
    keys.forEach(k => cache.del(k));
    return keys.length;
  }
  cache.flushAll();
  return 'all';
}

// All functions are exported using ES module syntax above
