// API VERCEL - DETALHES COMPLETOS DO PEDIDO
// Arquivo: api/order-details.js
// Atualizado: Janeiro 2025
// Correção: Compatibilidade com CommonJS

module.exports = async function handler(req, res) {
  // Permitir acesso do seu site Shopify
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Se for OPTIONS, retornar OK
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Só aceitar GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // Pegar ID do pedido da URL
    const { orderId } = req.query;
    
    if (!orderId) {
      return res.status(400).json({ error: 'ID do pedido é obrigatório' });
    }

    // Configurações da Shopify
    const SHOPIFY_DOMAIN = 'orne-decor-studio.myshopify.com';
    const SHOPIFY_ACCESS_TOKEN = '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';

    // URL da API Shopify
    const shopifyUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders/${orderId}.json`;
    
    // Buscar pedido na Shopify
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

    // Processar tracking do AliExpress
    let aliexpressOrder = null;
    let accountId = null;
    
    // Buscar nas notas do pedido
    if (order.note) {
      const noteLines = order.note.split('\n');
      noteLines.forEach(line => {
        if (line.includes('AliExpress Order')) {
          const match = line.match(/#?\s*(\d+)/);
          if (match) aliexpressOrder = match[1];
        }
        if (line.includes('Account id')) {
          const match = line.match(/br(\d+)/i);
          if (match) accountId = 'br' + match[1];
        }
      });
    }

    // Processar fulfillments (rastreamentos)
    const trackingNumbers = [];
    if (order.fulfillments && order.fulfillments.length > 0) {
      order.fulfillments.forEach(f => {
        if (f.tracking_number) {
          trackingNumbers.push({
            number: f.tracking_number,
            company: f.tracking_company || 'Não especificado',
            url: f.tracking_url || null,
            status: f.shipment_status || 'in_transit'
          });
        }
        if (f.tracking_numbers && f.tracking_numbers.length > 0) {
          f.tracking_numbers.forEach((tn, index) => {
            if (!trackingNumbers.find(t => t.number === tn)) {
              trackingNumbers.push({
                number: tn,
                company: f.tracking_company || 'Não especificado',
                url: f.tracking_urls ? f.tracking_urls[index] : null,
                status: f.shipment_status || 'in_transit'
              });
            }
          });
        }
      });
    }

    // Montar resposta completa
    const processedOrder = {
      // Informações básicas
      id: order.id,
      order_number: order.order_number || order.name,
      name: order.name,
      created_at: order.created_at,
      processed_at: order.processed_at,
      
      // Status
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status || 'unfulfilled',
      
      // Valores
      currency: order.currency || 'BRL',
      subtotal_price: order.subtotal_price,
      total_discounts: order.total_discounts,
      total_price: order.total_price,
      total_tax: order.total_tax,
      
      // Cliente
      customer: order.customer ? {
        id: order.customer.id,
        email: order.customer.email,
        first_name: order.customer.first_name,
        last_name: order.customer.last_name,
        phone: order.customer.phone,
        orders_count: customerOrders,
        total_spent: order.customer.total_spent,
        tags: order.customer.tags
      } : null,
      
      // Endereço de entrega
      shipping_address: order.shipping_address ? {
        name: `${order.shipping_address.first_name} ${order.shipping_address.last_name}`,
        company: order.shipping_address.company, // CPF/CNPJ
        address1: order.shipping_address.address1,
        address2: order.shipping_address.address2,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        province_code: order.shipping_address.province_code,
        country: order.shipping_address.country,
        zip: order.shipping_address.zip,
        phone: order.shipping_address.phone
      } : null,
      
      // Produtos
      line_items: order.line_items ? order.line_items.map(item => ({
        id: item.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        title: item.title,
        variant_title: item.variant_title,
        sku: item.sku,
        quantity: item.quantity,
        price: item.price,
        total_discount: item.total_discount
      })) : [],
      
      // Rastreamento
      tracking_numbers: trackingNumbers,
      
      // Descontos
      discount_codes: order.discount_codes || [],
      total_discount_amount: order.total_discounts,
      
      // Frete
      shipping_lines: order.shipping_lines ? order.shipping_lines.map(s => ({
        title: s.title,
        price: s.price,
        code: s.code
      })) : [],
      
      // Tags e notas
      tags: order.tags,
      note: order.note,
      
      // Informações adicionais
      gateway: order.gateway,
      cart_token: order.cart_token,
      source_name: order.source_name,
      
      // AliExpress
      aliexpress_order: aliexpressOrder,
      aliexpress_url: aliexpressOrder ? 
        `https://trade.aliexpress.com/order_detail.htm?orderId=${aliexpressOrder}` : null,
      account_id: accountId
    };
    
    // Retornar sucesso
    return res.status(200).json({
      success: true,
      order: processedOrder
    });

  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Erro ao processar pedido'
    });
  }
}
