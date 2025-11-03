import type { UserDataBundle } from '../types.ts';

const JSONBIN_API_URL = 'https://api.jsonbin.io/v3/b';

export async function loadData(apiKey: string, binId: string, defaultData: UserDataBundle): Promise<UserDataBundle> {
    try {
        const response = await fetch(`${JSONBIN_API_URL}/${binId}/latest`, {
            method: 'GET',
            headers: {
                'X-Master-Key': apiKey,
                'X-Bin-Meta': 'false', // only get the record
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log("jsonbin.io: Bin not found or empty. Using default data.");
                return defaultData;
            }
            throw new Error(`Failed to load data from jsonbin.io: ${response.statusText}`);
        }

        const responseText = await response.text();
        if (!responseText) {
            return defaultData;
        }

        const data = JSON.parse(responseText);
        return data;
    } catch (error) {
        console.error("Error loading data from jsonbin.io, returning default.", error);
        return defaultData;
    }
}

export async function saveData(apiKey: string, binId: string, data: UserDataBundle): Promise<void> {
    try {
        const response = await fetch(`${JSONBIN_API_URL}/${binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': apiKey,
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`Failed to save data to jsonbin.io: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error saving data to jsonbin.io:", error);
        throw error;
    }
}
