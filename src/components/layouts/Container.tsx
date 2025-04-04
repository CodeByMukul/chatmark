import { useEffect, useState } from "react";
import { supabase } from "core/supabase"; // Ensure this path is correct
import { useUser, useClerk } from '@clerk/chrome-extension';
import "../../style.css"; // Ensure this path is correct
import useEnsureUserExists from "~custom";

// --- Constants ---
const DOMAIN_STORAGE_KEYS = {
    "chat.mistral.ai": "mistralUrls",
    "gemini.google.com": "geminiUrls",
    "claude.ai": "claudeUrls",
    "chatgpt.com": "gptUrls",
} as const;

const STORAGE_KEY_NAMES = {
    mistralUrls: "Mistral",
    geminiUrls: "Gemini",
    claudeUrls: "Claude",
    gptUrls: "ChatGPT"
} as const;

type StorageCategoryKey = keyof typeof STORAGE_KEY_NAMES;

// --- Helper Functions ---
function truncateUrl(url: string): string {
    try {
        if (!url) return '';
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        let truncatedPath = pathSegments.length > 0
            ? `/${pathSegments[0]}${pathSegments.length > 1 ? '/...' : ''}`
            : '/';
        return `${urlObj.hostname}${truncatedPath}`;
    } catch (error) {
        return url.substring(0, 30) + '...';
    }
}

function truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// --- Data Structure Interface ---
interface SavedUrlItem {
    id: string; 
    url: string;
    description: string | null;
    category: StorageCategoryKey;
    created_at: string; 
}

type SavedUrlsState = Record<StorageCategoryKey, SavedUrlItem[]>;

function IndexPopup() {
  useEnsureUserExists();
    const [currentUrl, setCurrentUrl] = useState<string>("");
    const [selectedKey, setSelectedKey] = useState<StorageCategoryKey | null>(null);
    const [savedUrls, setSavedUrls] = useState<SavedUrlsState>({
        mistralUrls: [],
        geminiUrls: [],
        claudeUrls: [],
        gptUrls: []
    });
    const [description, setDescription] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [hoveredUrl, setHoveredUrl] = useState<string | null>(null);

    // Operation State for DB operations
    const [loadingData, setLoadingData] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // --- Clerk Auth ---
    const { isLoaded, isSignedIn, user } = useUser();
    const clerk = useClerk();

    // When the user is loaded and signed in, load saved URLs
    useEffect(() => {
        if (isLoaded && isSignedIn && user) {
            loadAllSavedUrls(user.id);
        }
    }, [isLoaded, isSignedIn, user]);

    // --- Sign Out using Clerk ---
    async function handleSignOut() {
        setErrorMsg(null);
        setSuccessMsg(null);
        setLoadingData(true);
        try {
            await clerk.signOut();
        } catch(err: any) {
            setErrorMsg(`Sign-out failed: ${err.message}`);
        } finally {
            setLoadingData(false);
        }
    }

    function getStorageKey(url: string): StorageCategoryKey | null {
        try {
            if (!url) return null;
            const domain = new URL(url).hostname;
            return DOMAIN_STORAGE_KEYS[domain as keyof typeof DOMAIN_STORAGE_KEYS] || null;
        } catch (error) {
            return null;
        }
    }

    async function loadAllSavedUrls(userId: string) {
        if (!userId) return;
        setLoadingData(true);
        try {
            const { data, error } = await supabase
                .from('saved_urls')
                .select('id, url, description, category, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) {
                if (error.message.includes("violates row-level security policy")) {
                    console.error("RLS Policy Error:", error);
                    setErrorMsg("Error fetching data. Check table permissions (RLS).");
                } else {
                    throw error;
                }
                setSavedUrls({ mistralUrls: [], geminiUrls: [], claudeUrls: [], gptUrls: [] });
            } else {
                const newSavedUrls: SavedUrlsState = {
                    mistralUrls: [], geminiUrls: [], claudeUrls: [], gptUrls: []
                };
                if (data) {
                    data.forEach((item: any) => {
                        const categoryKey = item.category as StorageCategoryKey;
                        if (STORAGE_KEY_NAMES[categoryKey]) {
                            const processedItem: SavedUrlItem = {
                                id: item.id,
                                url: item.url,
                                description: item.description ?? null,
                                category: categoryKey,
                                created_at: item.created_at
                            };
                            newSavedUrls[categoryKey].push(processedItem);
                        } else {
                            console.warn("Skipping item with unknown category:", item);
                        }
                    });
                }
                setSavedUrls(newSavedUrls);
            }
        } catch (error: any) {
            console.error("Error loading saved URLs from Supabase:", error);
            setErrorMsg(`Failed to load URLs: ${error.message}`);
            setSavedUrls({ mistralUrls: [], geminiUrls: [], claudeUrls: [], gptUrls: [] });
        } finally {
            setLoadingData(false);
        }
    }

    async function clickToSave() {
        if (!isSignedIn || !user) {
            setErrorMsg("Please sign in to save URLs.");
            return;
        }
        if (!currentUrl) {
            setErrorMsg("No current URL detected to save.");
            return;
        }
        setErrorMsg(null);
        setSuccessMsg(null);
        const category = getStorageKey(currentUrl);
        if (!category) {
            setErrorMsg("Cannot save URL from this domain.");
            return;
        }

        const alreadyExists = savedUrls[category]?.some(item => item.url === currentUrl);
        if (alreadyExists) {
            setErrorMsg("This URL is already saved in this category.");
            return;
        }

        setLoadingData(true);
        try {
            const newItemData = {
                user_id: user.id,
                url: currentUrl,
                description: description || null,
                category: category
            };

            const { error } = await supabase.from('saved_urls').insert(newItemData);
            if (error) throw error;

            setDescription("");
            await loadAllSavedUrls(user.id); // Reload to get new item with ID

        } catch (error: any) {
            console.error("Error saving URL to Supabase:", error);
            if (error.message.includes("duplicate key value violates unique constraint")) {
                setErrorMsg("This URL might already be saved (database constraint).");
            } else if (error.message.includes("violates row-level security policy")) {
                setErrorMsg("Error saving: Check table insert permissions (RLS).");
            } else {
                setErrorMsg(`Failed to save URL: ${error.message}`);
            }
        } finally {
            setLoadingData(false);
        }
    }

    async function deleteUrl(itemToDelete: SavedUrlItem) {
        if (!isSignedIn || !user) {
            setErrorMsg("Please sign in to delete URLs.");
            return;
        }
        setErrorMsg(null);
        setSuccessMsg(null);
        setLoadingData(true);

        try {
            const { error } = await supabase
                .from('saved_urls')
                .delete()
                .match({ id: itemToDelete.id, user_id: user.id });

            if (error) throw error;

            // Optimistic UI Update
            setSavedUrls(prev => {
                const categoryKey = itemToDelete.category;
                const newState = { ...prev };
                if (newState[categoryKey]) {
                    newState[categoryKey] = newState[categoryKey].filter(item => item.id !== itemToDelete.id);
                }
                return newState;
            });
            console.log("Deleted item locally:", itemToDelete.id);

        } catch (error: any) {
            console.error("Error deleting URL from Supabase:", error);
            if (error.message.includes("violates row-level security policy")) {
                setErrorMsg("Error deleting: Check table delete permissions (RLS).");
            } else {
                setErrorMsg(`Failed to delete URL: ${error.message}`);
            }
            if(user) await loadAllSavedUrls(user.id);
        } finally {
            setLoadingData(false);
        }
    }

    // --- Get Current URL ---
    useEffect(() => {
        async function currentUrlSetter() {
            setErrorMsg(null);
            try {
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tabs.length > 0 && tabs[0].url) {
                        setCurrentUrl(tabs[0].url);
                    } else {
                        setCurrentUrl("");
                    }
                }
            } catch (error) {
                console.error("Error setting current URL:", error);
                setErrorMsg("Could not get current tab URL.");
                setCurrentUrl("");
            }
        }
        currentUrlSetter();
    }, []);

    const getFilteredResults = (): SavedUrlItem[] => {
        const query = searchQuery.toLowerCase();
        const allItems: SavedUrlItem[] = Object.values(savedUrls || {}).flat();
        let results: SavedUrlItem[];

        if (searchQuery) {
            results = allItems.filter(item =>
                item.url.toLowerCase().includes(query) ||
                item.description?.toLowerCase().includes(query)
            );
        } else if (selectedKey) {
            results = savedUrls[selectedKey] || [];
        } else {
            results = allItems;
        }
        return results;
    };

    const getTotalUrlCount = (storageKey?: string) => {
        if (storageKey) {
            return Array.isArray(savedUrls[storageKey as keyof SavedUrlsState])
                   ? savedUrls[storageKey as keyof SavedUrlsState].length
                   : 0;
        }
        return Object.values(savedUrls || {}).reduce((total, urls) => total + (urls?.length || 0), 0);
    };

    const filteredResults = getFilteredResults();
    const shouldDisplaySaveButton = isSignedIn && currentUrl && getStorageKey(currentUrl);

    // --- Render Logic ---
    if (!isLoaded) {
        return <div className="w-[400px] h-[100px] flex items-center justify-center text-gray-500">Checking Auth...</div>;
    }

    // If user is not signed in, show a minimal sign in/up prompt
    if (!isSignedIn) {
        return (
            <div className="w-[400px] min-h-[300px] p-4 bg-gray-50 flex flex-col items-center justify-center">
                <p className="mb-4 text-gray-700">Please sign in to manage your saved URLs.</p>
                <button
                    onClick={() => clerk.openSignIn()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition duration-200 text-sm font-medium"
                >
                    Sign In / Sign Up
                </button>
            </div>
        );
    }

    return (
        <div className="w-[400px] min-h-[300px] p-4 bg-gray-50 flex flex-col">

            {/* --- User Info / Sign Out Button --- */}
            {isSignedIn && user && (
                <div className="pb-3 mb-3 border-b border-gray-200 flex justify-between items-center h-10">
                    <span className="text-sm text-gray-600 truncate pr-2" title={user.emailAddresses[0]?.emailAddress || ''}>
                        Hi, {user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0] || 'User'}
                    </span>
                    <button
                        onClick={handleSignOut}
                        className="px-3 py-1 bg-red-100 text-red-700 text-xs rounded-md hover:bg-red-200 disabled:opacity-50"
                        disabled={loadingData}
                    >
                        Sign Out
                    </button>
                </div>
            )}

            {/* --- Error/Success/Loading Display --- */}
            {errorMsg && (
                <div className="mb-3 p-2 text-xs text-red-700 bg-red-100 border border-red-300 rounded-md">
                    {errorMsg}
                </div>
            )}
            {successMsg && (
                <div className="mb-3 p-2 text-xs text-green-700 bg-green-100 border border-green-300 rounded-md">
                    {successMsg}
                </div>
            )}
            {loadingData && (
                <div className="mb-3 text-center text-sm text-blue-500">
                    Processing...
                </div>
            )}

            {/* --- Main Content Area --- */}
            <>
                {/* Search Bar */}
                <div className="mb-4">
                    <div className="relative">
                        <input
                            type="text" value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                if (e.target.value) setSelectedKey(null);
                            }}
                            placeholder="Search your saved URLs..."
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all duration-200"
                            disabled={loadingData}
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery("")} aria-label="Clear search"
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                ×
                            </button>
                        )}
                    </div>
                </div>

                {/* Save Section */}
                {shouldDisplaySaveButton && (
                    <div className="mb-6 space-y-2 bg-white p-4 rounded-lg shadow-sm">
                        <input
                            type="text" value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add a description (optional)..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            disabled={loadingData}
                        />
                        <button
                            className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition duration-200 text-sm font-medium shadow-sm disabled:opacity-50"
                            onClick={clickToSave}
                            disabled={loadingData}
                        >
                            {loadingData ? 'Saving...' : 'Save Current URL'}
                        </button>
                    </div>
                )}

                {/* Category Filters */}
                {!searchQuery && (
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        {Object.entries(STORAGE_KEY_NAMES).map(([key, name]) => (
                            <button key={key}
                                className={`px-3 py-2 rounded-md transition duration-200 text-sm font-medium shadow-sm disabled:opacity-75 ${
                                    selectedKey === key
                                        ? "bg-blue-600 text-white ring-2 ring-blue-300"
                                        : "bg-white hover:bg-gray-50 text-gray-700 border border-gray-200"
                                }`}
                                onClick={() => setSelectedKey(key === selectedKey ? null : key as StorageCategoryKey)}
                                disabled={loadingData}
                            >
                                {name} ({getTotalUrlCount(key)})
                            </button>
                        ))}
                    </div>
                )}

                {/* Results List */}
                <div className="mt-4 flex-1 overflow-hidden flex flex-col">
                    {!loadingData && filteredResults.length > 0 ? (
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <h3 className="font-medium text-sm text-gray-600 mb-3 flex-shrink-0">
                                {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
                                {!searchQuery && selectedKey ? ` in ${STORAGE_KEY_NAMES[selectedKey]}` : ''}
                                {searchQuery && ` for "${truncateText(searchQuery, 20)}"`}
                            </h3>
                            <div className="overflow-y-auto pr-2 space-y-2 flex-1">
                                {filteredResults.map((item) => (
                                    <div key={item.id} className="flex items-start bg-white p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-all duration-200 group shadow-sm">
                                        <div className="flex flex-col flex-1 min-w-0">
                                            <div className="flex items-center gap-2 w-full mb-1">
                                                {(!selectedKey || searchQuery) && (
                                                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md font-medium flex-shrink-0">
                                                        {STORAGE_KEY_NAMES[item.category]}
                                                    </span>
                                                )}
                                                <div className="relative flex-1 min-w-0">
                                                    <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}
                                                       className="text-sm text-blue-600 hover:text-blue-700 truncate block"
                                                       onMouseEnter={() => setHoveredUrl(item.url)}
                                                       onMouseLeave={() => setHoveredUrl(null)}>
                                                        {truncateUrl(item.url)}
                                                    </a>
                                                    {hoveredUrl === item.url && (
                                                        <div className="absolute z-10 bg-gray-900 text-white p-2 rounded-md text-xs mt-1 max-w-xs break-all shadow-lg">
                                                            {item.url}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {item.description && (
                                                <p className="text-sm text-gray-600 truncate" title={item.description}>
                                                    {truncateText(item.description, 100)}
                                                </p>
                                            )}
                                        </div>
                                        <button onClick={() => deleteUrl(item)} title="Delete" disabled={loadingData}
                                            className="text-gray-400 hover:text-red-500 text-lg px-2 ml-2 flex-shrink-0 transition-colors duration-200 disabled:opacity-50">
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-gray-500 py-8 flex-1 flex items-center justify-center">
                            {!loadingData && (
                                getTotalUrlCount() > 0 ? (
                                    searchQuery ? <p>No results found for "{searchQuery}"</p>
                                    : selectedKey ? <p>No URLs saved in "{STORAGE_KEY_NAMES[selectedKey]}" yet.</p>
                                    : <p>No items match the current filter.</p>
                                ) : (
                                    <p>No saved URLs yet. Navigate to a supported site like chatgpt.com to save one.</p>
                                )
                            )}
                        </div>
                    )}
                </div>
            </>
        </div>
    );
}

export default IndexPopup;

