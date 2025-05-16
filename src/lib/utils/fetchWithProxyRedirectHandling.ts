import { goto } from '$app/navigation';
// Remove the environment import and use a more flexible approach
// import { PUBLIC_API_HOST } from '$env/static/public';

/**
 * Wrapper around fetch that handles 302 redirects from Microsoft Entra proxy
 * when the token expires.
 * 
 * @param input Request URL or Request object
 * @param init Request initialization options
 * @returns Promise with fetch response
 */
export async function fetchWithProxyRedirectHandling(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Execute the fetch request
  const response = await fetch(input, init);
  
  // Check if we received a 302 redirect from the proxy
  if (response.status === 302) {
    console.warn('Received 302 redirect - session likely expired in proxy');
    
    // Get the location header (where the proxy wants to redirect)
    const redirectUrl = response.headers.get('location');
    
    // If we want to capture the redirect URL for analytics or debugging
    if (redirectUrl) {
      console.log('Redirect URL:', redirectUrl);
      // You could store this in localStorage if needed
    }
    
    // Force logout by clearing token cookie and redirecting to login
    document.cookie = 'token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    localStorage.removeItem('tokenExpiryTime');
    
    // Redirect to login page
    goto('/auth');
    
    // Return a rejected promise to indicate authentication failure
    return Promise.reject(new Error('Authentication expired in proxy, redirecting to login'));
  }
  
  // For all other responses, return normally
  return response;
}

/**
 * Replace the global fetch with our wrapped version
 * Call this in a top-level layout file to intercept all fetch calls
 * 
 * @param apiUrlPattern Optional pattern to match API URLs that should be intercepted
 */
export function installGlobalFetchInterceptor(apiUrlPattern?: string) {
  const originalFetch = window.fetch;
  
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      // Only intercept requests to our API
      const url = input instanceof Request ? input.url : input.toString();
      
      // If apiUrlPattern is provided, use it. Otherwise, intercept all requests
      if (!apiUrlPattern || url.includes(apiUrlPattern)) {
        return await fetchWithProxyRedirectHandling(input, init);
      }
      
      // Pass through other requests to original fetch
      return await originalFetch(input, init);
    } catch (error) {
      // Rethrow any errors
      throw error;
    }
  };
  
  console.log('Installed global fetch interceptor for handling 302 redirects');
} 