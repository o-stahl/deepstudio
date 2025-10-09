'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/ui/logo';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface HeaderAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  disabled?: boolean;
  content?: React.ReactNode;
  dataTourId?: string;
}

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  badge?: string;
  onLogoClick?: () => void;
  actions?: HeaderAction[];
  mobileMenuContent?: React.ReactNode;
  desktopOnlyContent?: React.ReactNode; // Content shown only on desktop
  className?: string;
  leftText?: string; // Text to show next to logo on desktop, centered on mobile
  mobileVisibleActions?: string[]; // Action IDs to show outside dropdown on mobile
}

export function AppHeader({
  title,
  subtitle,
  badge,
  onLogoClick,
  actions = [],
  mobileMenuContent,
  desktopOnlyContent,
  className = '',
  leftText,
  mobileVisibleActions = []
}: AppHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Split actions into mobile-visible and dropdown-only
  const mobileVisibleActionsSet = new Set(mobileVisibleActions);
  const visibleOnMobile = actions.filter(a => mobileVisibleActionsSet.has(a.id));
  const dropdownOnlyActions = actions.filter(a => !mobileVisibleActionsSet.has(a.id));

  return (
    <div className={`border-b bg-card shadow-sm relative z-20 ${className}`}>
      <div className="px-3 py-2 flex items-center justify-between">
        {/* Left side - Logo + text (desktop), Logo only (mobile) */}
        <button 
          onClick={onLogoClick}
          className="flex items-center gap-2 p-1 pr-2 hover:ring-1 hover:ring-border rounded-sm transition-all"
        >
          <Logo width={24} height={24} />
          {/* Show leftText next to logo on desktop only */}
          {leftText && <span className="font-semibold text-lg hidden md:inline">{leftText}</span>}
        </button>

        {/* Center - leftText on mobile, title/badge on desktop */}
        <div className="flex items-center gap-2 flex-1 justify-center md:justify-start md:ml-6">
          {leftText ? (
            /* Show leftText in center on mobile */
            <h1 className="text-lg font-semibold md:hidden">{leftText}</h1>
          ) : title ? (
            <>
              {title && <h1 className="text-lg md:text-xl font-semibold">{title}</h1>}
              {badge && <Badge variant="secondary">{badge}</Badge>}
            </>
          ) : null}
        </div>

        {/* Desktop - Show subtitle only if no leftText and no center title */}
        {!leftText && !title && subtitle && (
          <div className="hidden md:flex items-center flex-1 ml-6">
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          </div>
        )}

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2">
            {actions.map((action) => (
              action.content ? (
                <div key={action.id}>{action.content}</div>
              ) : (
                <Button
                  key={action.id}
                  variant={action.variant || 'outline'}
                  size={action.size || 'sm'}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="justify-start"
                  data-tour-id={action.dataTourId}
                >
                  {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                  {action.label}
                </Button>
              )
            ))}
            {desktopOnlyContent}
          </div>

          {/* Mobile visible actions */}
          <div className="md:hidden flex items-center gap-2">
            {visibleOnMobile.map((action) => (
              action.content ? (
                <div key={action.id}>{action.content}</div>
              ) : (
                <Button
                  key={action.id}
                  variant={action.variant || 'outline'}
                  size={action.size || 'sm'}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="h-8 px-3"
                  data-tour-id={action.dataTourId}
                >
                  {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                  {action.label}
                </Button>
              )
            ))}
          </div>

          {/* Mobile menu toggle */}
          {(dropdownOnlyActions.length > 0 || mobileMenuContent) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="h-8 w-8 md:hidden"
            >
              {mobileMenuOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
      
      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (dropdownOnlyActions.length > 0 || mobileMenuContent) && (
        <div className="md:hidden border-t bg-muted/30 px-4 py-4 space-y-3">
          {/* Show subtitle on mobile if no leftText and no center title */}
          {!leftText && !title && subtitle && (
            <div className="pb-2 border-b border-border/50">
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
          )}

          {/* Mobile dropdown-only actions */}
          {dropdownOnlyActions.length > 0 && (
            <div className="space-y-2">
              {dropdownOnlyActions.map((action) => (
                action.content ? (
                  <div key={action.id}>{action.content}</div>
                ) : (
                  <Button
                    key={action.id}
                    variant={action.variant || 'outline'}
                    size={action.size || 'sm'}
                    onClick={() => {
                      action.onClick();
                      setMobileMenuOpen(false);
                    }}
                    disabled={action.disabled}
                    className="w-full justify-start"
                    data-tour-id={action.dataTourId}
                  >
                    {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                    {action.label}
                  </Button>
                )
              ))}
            </div>
          )}

          {/* Custom mobile menu content */}
          {mobileMenuContent && (
            <div className="pt-2 border-t border-border/50">
              {mobileMenuContent}
            </div>
          )}
        </div>
      )}
    </div>
  );
}