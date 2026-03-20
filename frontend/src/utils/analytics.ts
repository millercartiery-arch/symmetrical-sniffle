/**
 * Simple analytics utility for user behavior tracking.
 */
export const trackEvent = (eventName: string, properties: Record<string, any> = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[Analytics] ${timestamp} - ${eventName}:`, properties);
  
  // In a real application, you would send this to a backend or a service like Google Analytics/Mixpanel.
  /*
  fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName, properties, timestamp })
  }).catch(err => console.error('Analytics failed:', err));
  */
};

export const trackPageView = (pageName: string) => {
  trackEvent('page_view', { page: pageName, url: window.location.href });
};
