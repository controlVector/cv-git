/**
 * API Gateway - TypeScript/Node.js
 * Routes requests to appropriate microservices
 */

import { Request, Response } from 'express';

interface ServiceResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Main request handler for the API gateway
 * Routes incoming requests to appropriate backend services
 */
export async function handleRequest(req: Request, res: Response): Promise<void> {
  const { service, action } = req.params;

  try {
    // Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.success) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Route to appropriate service
    let result: ServiceResponse;
    switch (service) {
      case 'data':
        result = await callDataService(action, req.body);
        break;
      case 'compute':
        result = await callComputeService(action, req.body);
        break;
      case 'legacy':
        result = await callLegacyService(action, req.body);
        break;
      default:
        res.status(404).json({ error: 'Service not found' });
        return;
    }

    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
}

/**
 * Authenticate incoming request using auth service
 */
async function authenticateRequest(req: Request): Promise<ServiceResponse> {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return { success: false, error: 'No token provided' };
  }

  // Call Go auth service
  const response = await fetch('http://auth-service:8080/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });

  return response.json();
}

/**
 * Call Python data processing service
 */
async function callDataService(action: string, data: any): Promise<ServiceResponse> {
  const response = await fetch(`http://data-service:8081/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  return response.json();
}

/**
 * Call Rust compute engine
 */
async function callComputeService(action: string, data: any): Promise<ServiceResponse> {
  const response = await fetch(`http://compute-service:8082/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  return response.json();
}

/**
 * Call Java legacy system
 */
async function callLegacyService(action: string, data: any): Promise<ServiceResponse> {
  const response = await fetch(`http://legacy-service:8083/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  return response.json();
}

/**
 * Centralized error handler
 */
function handleError(error: unknown, res: Response): void {
  console.error('Gateway error:', error);

  if (error instanceof Error) {
    res.status(500).json({ error: error.message });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Health check endpoint
 */
export function healthCheck(): { status: string; uptime: number } {
  return {
    status: 'healthy',
    uptime: process.uptime()
  };
}

/**
 * Get service metrics
 */
export async function getMetrics(): Promise<any> {
  // This function has high complexity intentionally for demo
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  const services = ['data', 'compute', 'legacy', 'auth'];
  const metrics: any = {};

  for (const service of services) {
    try {
      const response = await fetch(`http://${service}-service:808x/metrics`);
      const data = await response.json();
      metrics[service] = data;
      totalRequests += data.requests || 0;
      successfulRequests += data.successful || 0;
      failedRequests += data.failed || 0;
    } catch (error) {
      metrics[service] = { error: 'unavailable' };
    }
  }

  return {
    total: totalRequests,
    successful: successfulRequests,
    failed: failedRequests,
    services: metrics
  };
}
