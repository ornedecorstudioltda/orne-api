// API VERCEL - DETALHES COMPLETOS DO PEDIDO V2.0
// Arquivo: api/order-details.js
// Atualizado: Janeiro 2025
// Correções: Todos os dados do pedido + formatação

module.exports = async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { orderId } = req.query;
    
    if (!orderId) {
      return res.status(400).json({ error: 'ID do pedido é obrigatório' });
    }

    // Configurações Shopify
    const SHOPIFY_DOMAIN = 'orne-decor-studio.myshopify.com';
    const SHOPIFY_ACCESS_TOKEN = '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';

    // Buscar pedido completo
    const shopifyUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${orderId}.json`;
    
    const response = await fetch(shopifyUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Pedido não encontrado' });
      }
      return res.status(response.status).json({ 
        error: 'Erro ao buscar pedido'
      });
    }

    const data = await response.json();
    const order = data.order;

    // Buscar total de pedidos do cliente
    let customerOrders = 1;
    if (order.customer && order.customer.id) {
      try {
        const customerUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/customers/${order.customer.id}/orders/count.json`;
        const customerResponse = await fetch(customerUrl, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });
        
        if (customerResponse.ok) {
          const customerData = await customerResponse.json();
          customerOrders = customerData.count || 1;
        }
      } catch (error) {
        console.log('Erro ao buscar histórico:', error);
      }
    }

    // Processar informações adicionais (note_attributes)
    let additionalInfo = {};
    if (order.note_attributes && Array.isArray(order.note_attributes)) {
      order.note_attributes.forEach(attr => {
        // Padronizar nomes dos campos
        const key = attr.name.toLowerCase()
          .replace(/ /g, '_')
          .replace(/[^a-z0-9_]/g, '');
        additionalInfo[key] = attr.value;
      });
    }

    // Extrair AliExpress Order de diferentes fontes
    let aliexpressOrders = [];
    
    // 1. Verificar note_attributes
    if (additionalInfo.aliexpress_order) {
      const orders = additionalInfo.aliexpress_order.split(',').map(o => o.trim());
      aliexpressOrders = orders;
    }
    
    // 2. Verificar na nota do pedido
    if (order.note) {
      const aliMatch = order.note.match(/AliExpress Order #?\s*(\d+)/gi);
      if (aliMatch) {
        aliMatch.forEach(match => {
          const orderNum = match.match(/\d+/);
          if (orderNum && !aliexpressOrders.includes(orderNum[0])) {
            aliexpressOrders.push(orderNum[0]);
          }
        });
      }
    }

    // Processar trackings
    const trackingNumbers = [];
    if (order.fulfillments && order.fulfillments.length > 0) {
      order.fulfillments.forEach(f => {
        // Tracking único
        if (f.tracking_number) {
          trackingNumbers.push({
            number: f.tracking_number,
            company: f.tracking_company || 'Correios',
            url: f.tracking_url,
            status: f.shipment_status || 'in_transit',
            created_at: f.created_at
          });
        }
        
        // Múltiplos trackings
        if (f.tracking_numbers && Array.isArray(f.tracking_numbers)) {
          f.tracking_numbers.forEach((tn, index) => {
            if (!trackingNumbers.find(t => t.number === tn)) {
              trackingNumbers.push({
                number: tn,
                company: f.tracking_company || 'Correios',
                url: f.tracking_urls ? f.tracking_urls[index] : null,
                status: f.shipment_status || 'in_transit',
                created_at: f.created_at
              });
            }
          });
        }
      });
    }

    // Calcular totais dos produtos
    let totalItems = 0;
    const processedLineItems = order.line_items ? order.line_items.map(item => {
      totalItems += item.quantity;
      return {
        id: item.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        title: item.title,
        variant_title: item.variant_title,
        sku: item.sku,
        quantity: item.quantity,
        price: item.price,
        total_price: parseFloat(item.price) * item.quantity,
        total_discount: item.total_discount || 0,
        properties: item.properties || []
      };
    }) : [];

// Montar resposta completa
    const processedOrder = {
      // Informações básicas
      id: order.id,
      order_number: order.order_number || order.name,
      name: order.name,
      created_at: order.created_at,
      processed_at: order.processed_at || order.created_at, // Fallback se não tiver
      updated_at: order.updated_at,
      
      // Status
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status || 'unfulfilled',
      cancelled_at: order.cancelled_at,
      
      // Valores
      currency: order.currency || 'BRL',
      subtotal_price: order.subtotal_price,
      total_discounts: order.total_discounts || '0.00',
      total_price: order.total_price,
      total_tax: order.total_tax || '0.00',
      total_items: totalItems,
      
      // Cliente com telefone correto
      customer: order.customer ? {
        id: order.customer.id,
        email: order.customer.email,
        first_name: order.customer.first_name,
        last_name: order.customer.last_name,
        phone: order.customer.phone || order.customer.default_address?.phone || null,
        orders_count: customerOrders,
        total_spent: order.customer.total_spent,
        tags: order.customer.tags || ''
      } : null,
      
      // Endereço de entrega com telefone
      shipping_address: order.shipping_address ? {
        name: `${order.shipping_address.first_name} ${order.shipping_address.last_name}`,
        first_name: order.shipping_address.first_name,
        last_name: order.shipping_address.last_name,
        company: order.shipping_address.company || '', // CPF/CNPJ
        address1: order.shipping_address.address1,
        address2: order.shipping_address.address2 || '',
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        province_code: order.shipping_address.province_code,
        country: order.shipping_address.country,
        zip: order.shipping_address.zip,
        phone: order.shipping_address.phone || ''
      } : null,
      
      // Produtos processados
      line_items: processedLineItems,
      
      // Rastreamento
      tracking_numbers: trackingNumbers,
      
      // Descontos
      discount_codes: order.discount_codes || [],
      discount_applications: order.discount_applications || [],
      total_discount_amount: order.total_discounts || '0.00',
      
      // Frete
      shipping_lines: order.shipping_lines ? order.shipping_lines.map(s => ({
        title: s.title,
        price: s.price,
        code: s.code,
        source: s.source
      })) : [],
      
      // Tags e notas
      tags: order.tags || '',
      note: order.note || '',
      note_attributes: order.note_attributes || [],
      
      // Informações adicionais processadas
      additional_info: {
        gateway: additionalInfo.gateway || order.gateway || '',
        cart_id: additionalInfo.cart_id || '',
        discount_highlight: additionalInfo.discount_highlight || '',
        source_platform: additionalInfo.source_platform || order.source_name || '',
        utm_source: additionalInfo.utm_source || '',
        utm_medium: additionalInfo.utm_medium || '',
        utm_campaign: additionalInfo.utm_campaign || '',
        utm_term: additionalInfo.utm_term || '',
        utm_content: additionalInfo.utm_content || ''
      },
      
      // AliExpress
      aliexpress_orders: aliexpressOrders,
      aliexpress_order: aliexpressOrders.length > 0 ? aliexpressOrders[0] : null,
      aliexpress_urls: aliexpressOrders.map(orderId => ({
        order_id: orderId,
        url: `https://trade.aliexpress.com/order_detail.htm?orderId=${orderId}`
      })),
      account_id: additionalInfo.account_id || additionalInfo.account || ''
    };
    
    // Retornar resposta
    return res.status(200).json({
      success: true,
      order: processedOrder
    });

  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Erro ao processar pedido',
      message: error.message
    });
  }
}
