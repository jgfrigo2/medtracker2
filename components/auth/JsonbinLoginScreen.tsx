import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext.tsx';

export default function JsonbinLoginScreen() {
    const { login, isLoading } = useAppContext();
    const [apiKey, setApiKey] = useState('');
    const [binId, setBinId] = useState('');
    const [error, setError] = useState('');

    const handleLogin = () => {
        if (!apiKey.trim() || !binId.trim()) {
            setError('La clave API y el ID del bin son obligatorios.');
            return;
        }
        setError('');
        login(apiKey, binId);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-slate-800">Monitor de Salud</h1>
                    <p className="mt-2 text-slate-500">
                        Ingrese sus credenciales de jsonbin.io para sincronizar sus datos.
                    </p>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4">
                     <div>
                        <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 text-left">Clave API (X-Master-Key)</label>
                        <input
                            id="apiKey"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full mt-1 p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Su clave API de jsonbin.io"
                            required
                        />
                    </div>
                     <div>
                        <label htmlFor="binId" className="block text-sm font-medium text-slate-700 text-left">ID del Bin</label>
                        <input
                            id="binId"
                            type="text"
                            value={binId}
                            onChange={(e) => setBinId(e.target.value)}
                            className="w-full mt-1 p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Su ID de bin de jsonbin.io"
                            required
                        />
                    </div>

                    {error && <p className="text-sm text-red-500">{error}</p>}

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full inline-flex justify-center items-center px-4 py-3 font-semibold text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-300 disabled:bg-blue-400 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Cargando...' : 'Iniciar sesión'}
                        </button>
                    </div>
                </form>
                 <p className="text-xs text-slate-400 text-center">
                    Los datos se almacenarán en su bin privado de jsonbin.io.
                </p>
            </div>
        </div>
    );
}
