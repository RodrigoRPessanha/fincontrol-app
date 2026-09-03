import React from 'react';
import {
  Utensils,
  Home,
  Car,
  HeartPulse,
  GraduationCap,
  Gamepad2,
  Wallet,
  TrendingUp,
  PlusCircle,
  ShoppingCart,
  Bike,
  Zap,
  Droplet,
  Wifi,
  Fuel,
  Wrench,
  Pill,
  Dumbbell,
  Laptop,
  CreditCard,
  Building,
  Tag,
  ShieldCheck,
  Plane,
  AlertCircle,
  HelpCircle,
  LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  utensils: Utensils,
  home: Home,
  car: Car,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  'gamepad-2': Gamepad2,
  wallet: Wallet,
  'trending-up': TrendingUp,
  'plus-circle': PlusCircle,
  'shopping-cart': ShoppingCart,
  bike: Bike,
  zap: Zap,
  droplet: Droplet,
  wifi: Wifi,
  fuel: Fuel,
  wrench: Wrench,
  pill: Pill,
  dumbbell: Dumbbell,
  laptop: Laptop,
  'credit-card': CreditCard,
  building: Building,
  tag: Tag,
  'shield-check': ShieldCheck,
  plane: Plane,
  'alert-circle': AlertCircle,
};

interface CategoryIconProps {
  iconName?: string;
  className?: string;
  color?: string;
}

export function CategoryIcon({ iconName = 'tag', className = 'w-4 h-4', color }: CategoryIconProps) {
  const IconComponent = iconMap[iconName] || Tag;
  return <IconComponent className={className} style={color ? { color } : undefined} />;
}
