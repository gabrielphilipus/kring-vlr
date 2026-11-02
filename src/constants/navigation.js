import {
  Activity,
  BarChart3,
  BookOpen,
  Crosshair,
  LayoutDashboard,
  Map as MapIcon,
  Swords,
  Target,
  Video,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'veto', label: 'Simulador de veto', icon: MapIcon },
  { id: 'vods', label: 'Biblioteca de VODs', icon: Video },
  { id: 'lineups', label: 'Lineups', icon: Target },
  { id: 'gameplans', label: 'Gameplans', icon: Swords },
  { id: 'catalogs', label: 'Mapas e agentes', icon: Crosshair },
  { id: 'tactics', label: 'Táticos', icon: BookOpen },
  { id: 'training', label: 'Treino individual', icon: Activity },
  { id: 'stats', label: 'Estatísticas', icon: BarChart3 },
];
