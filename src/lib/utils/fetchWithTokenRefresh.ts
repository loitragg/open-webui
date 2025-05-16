import { goto } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { user } from '$lib/stores';

// Track redirecting state to prevent multiple redirects
let isRedirecting = false;

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
  
  setInterval(checkTokenValidity, 20000); // Check token validity every 20 seconds
  
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
          const now = Math.floor(Date.now() / 1000);
          
          // If token expires soon (within 30 seconds) or is expired
          if (now >= expiresAt - 30) {
            console.log(`TOKEN EXPIRING/EXPIRED: Expires at ${expiresAt}, current time ${now}`);
            forceLogoutAndRedirect();
            return;
          }
        }
      } catch (e) {
        console.error('Error checking token expiration:', e);
      }
    }
    
    // Also check if we can make a simple authenticated request
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
 */
function forceLogoutAndRedirect() {
  // Prevent multiple redirects
  if (isRedirecting) return;
  isRedirecting = true;
  
  console.log('🔐 TOKEN EXPIRED! FORCING LOGOUT AND PAGE RELOAD 🔐');
  
  try {
    // Clear user data
    user.set(undefined);
    
    // Remove token from localStorage 
    localStorage.removeItem('token');
    
    // Show notification
    toast.error('Your session has expired. Logging you out...', {
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