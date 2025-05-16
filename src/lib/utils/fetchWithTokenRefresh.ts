import { goto } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { user, config } from '$lib/stores';

// Track redirecting state to prevent multiple redirects
let isRedirecting = false;

/**
 * Calculate buffer time based on token duration
 * - For shorter durations (< 10 min), use smaller buffer (5%)
 * - For medium durations (< 1 hour), use medium buffer (3%)
 * - For longer durations, use larger buffer (2%)
 * - Minimum buffer is 5 seconds
 * - Maximum buffer is 120 seconds (2 minutes)
 * 
 * @param expiresAt Unix timestamp when token expires
 * @returns Buffer time in seconds
 */
export function calculateExpiryBuffer(expiresAt: number): number {
  // Current time in seconds
  const now = Math.floor(Date.now() / 1000);
  
  // Total token lifetime in seconds
  const tokenLifetime = expiresAt - now;
  
  if (tokenLifetime <= 0) {
    return 0; // Already expired
  }
  
  let bufferSeconds: number;
  
  // For short-lived tokens (< 10 minutes)
  if (tokenLifetime < 600) {
    bufferSeconds = Math.max(5, Math.floor(tokenLifetime * 0.05)); // 5% buffer, minimum 5 seconds
  }
  // For medium-lived tokens (< 1 hour)
  else if (tokenLifetime < 3600) {
    bufferSeconds = Math.floor(tokenLifetime * 0.03); // 3% buffer
  }
  // For long-lived tokens
  else {
    bufferSeconds = Math.min(120, Math.floor(tokenLifetime * 0.02)); // 2% buffer, maximum 2 minutes
  }
  
  return bufferSeconds;
}

/**
 * Checks if a token is about to expire based on expiry time and calculated buffer
 * 
 * @param expiresAt Unix timestamp when token expires
 * @returns true if token is expiring soon, false otherwise
 */
export function isTokenExpiringSoon(expiresAt: number | undefined): boolean {
  if (!expiresAt) return false;
  
  const now = Math.floor(Date.now() / 1000);
  const buffer = calculateExpiryBuffer(expiresAt);
  
  // Token is expiring soon if current time + buffer >= expiry time
  return now >= (expiresAt - buffer);
}

/**
 * Set up the global fetch interceptor to catch 401 Unauthorized responses
 * and redirect to login page when token expires
 */
export function setupFetchInterceptor() {
  // Store the original fetch function
  const originalFetch = window.fetch;
  
  // Replace the global fetch with our interceptor
  window.fetch = async function(input, init) {
    try {
      // Call the original fetch function
      const response = await originalFetch.apply(this, [input, init]);
      
      // Check for 302 redirects from Microsoft Entra proxy
      if (response.status === 302) {
        console.log('302 REDIRECT DETECTED - LIKELY PROXY SESSION EXPIRED', { 
          url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : 'unknown',
          location: response.headers.get('location')
        });
        
        // Force logout and redirect immediately
        forceLogoutAndRedirect('Your proxy session has expired');
        return response; // Return the response even though we're redirecting
      }
      
      // Immediately check for 401 status without attempting to parse
      if (response.status === 401) {
        console.log('401 UNAUTHORIZED DETECTED - FORCING LOGOUT', { 
          url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : 'unknown'
        });
        
        // Force logout and redirect immediately
        forceLogoutAndRedirect();
      }
      
      // Return the original response to preserve normal fetch behavior
      return response;
    } catch (error) {
      // Check if this error is authentication related
      const err = error as any; // Type assertion for better type checking
      if (err?.status === 401 || (typeof err?.message === 'string' && err.message.includes('unauthorized'))) {
        console.log('FETCH ERROR DETECTED - POSSIBLY AUTH RELATED', error);
        forceLogoutAndRedirect();
      }
      // Rethrow the error to preserve original behavior
      throw error;
    }
  };
  
  // Also set up a global AJAX error handler for APIs that might not use fetch
  window.addEventListener('unhandledrejection', function(event) {
    console.log('Unhandled promise rejection', event?.reason);
    const reason = event?.reason as any; // Type assertion
    if (reason?.status === 401) {
      console.log('401 ERROR IN UNHANDLED REJECTION - FORCING LOGOUT');
      forceLogoutAndRedirect();
    }
  });
  
  // Add storage event listener to coordinate across tabs
  window.addEventListener('storage', function(event) {
    if (event.key === 'token' && event.newValue === null) {
      // Token was removed in another tab
      console.log('TOKEN REMOVED IN ANOTHER TAB - REDIRECTING');
      window.location.reload();
    }
  });
  
  setInterval(checkTokenValidity, 15000); // Check token validity every 15 seconds
  
  console.log('Token expiration interceptor installed successfully');
}

// Check if token is expired based on stored expiration timestamp
function checkTokenValidity() {
  try {
    // Get the token from localStorage
    const token = localStorage.getItem('token');
    
    // If no token, nothing to check
    if (!token) {
      return;
    }
    
    // Try to get expiration time from user store or parse it from token
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const userData = JSON.parse(userStr);
        const expiresAt = userData?.expires_at;
        
        if (expiresAt) {
          // Use our dynamic buffer calculation to determine if token is expiring soon
          if (isTokenExpiringSoon(expiresAt)) {
            console.log(`TOKEN EXPIRING SOON: Expires at ${expiresAt}, current time ${Math.floor(Date.now() / 1000)}, using buffer of ${calculateExpiryBuffer(expiresAt)} seconds`);
            forceLogoutAndRedirect();
            return;
          }
        }
      } catch (e) {
        console.error('Error checking token expiration:', e);
      }
    }
    
    // Perform a health check as a backup
    fetch(`${window.location.origin}/health`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(err => {
      console.log('Health check failed, possibly token expired:', err);
    });
    
  } catch (err) {
    console.error('Error in token validity check:', err);
  }
}

/**
 * Force logout and redirect to login page - using the most direct methods
 * to ensure the page actually reloads
 * 
 * @param customMessage Optional custom message to display during logout
 */
function forceLogoutAndRedirect(customMessage?: string) {
  // Prevent multiple redirects
  if (isRedirecting) return;
  isRedirecting = true;
  
  console.log('🔐 SESSION EXPIRED! FORCING LOGOUT AND PAGE RELOAD 🔐');
  
  try {
    // Clear user data
    user.set(undefined);
    
    // Remove token from localStorage 
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Show notification
    toast.error(customMessage || 'Your session has expired. Logging you out...', {
      duration: 3000
    });
    
    // Force navigation to login page with hard reload
    // This is the most direct way to ensure the page reloads
    const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/auth?redirect=${currentUrl}&expired=true&t=${Date.now()}`;
    
    // As a backup, force reload after a short delay if redirect doesn't happen
    setTimeout(() => {
      window.location.reload();
    }, 1000);
    
  } catch (e) {
    console.error('Error during forced logout:', e);
    // Last resort: force reload
    window.location.reload();
  } finally {
    // Reset redirecting flag after a delay
    setTimeout(() => {
      isRedirecting = false;
    }, 5000);
  }
} 