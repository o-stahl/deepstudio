'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Project } from '@/lib/vfs/types';
import { vfs } from '@/lib/vfs';
import { logger } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ProjectCard } from './project-card';
import { MultipagePreview } from '@/components/preview/multipage-preview';
import { AboutModal } from '@/components/about-modal';
import { 
  Plus, 
  FolderOpen, 
  Upload,
  Settings,
  Search,
  LayoutGrid,
  List,
  ArrowUpDown,
  Info,
  TestTube,
  Github
} from 'lucide-react';
import { AppHeader, HeaderAction } from '@/components/ui/app-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { 
  BAREBONES_PROJECT_TEMPLATE,
  createProjectFromTemplate,
  createDemoProjectWithAssets
} from '@/lib/vfs/project-templates';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SettingsPanel } from '@/components/settings';
import { useGuidedTour } from '@/components/guided-tour/context';
import { GuidedTourOverlay } from '@/components/guided-tour/overlay';
import { configManager } from '@/lib/config/storage';

interface ProjectManagerProps {
  onProjectSelect: (project: Project) => void;
}

type SortOption = 'updated' | 'created' | 'name' | 'size';
type ViewMode = 'grid' | 'list';

export function ProjectManager({ onProjectSelect }: ProjectManagerProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectTemplate, setNewProjectTemplate] = useState<'blank' | 'demo'>('blank');
  const [sortBy, setSortBy] = useState<SortOption>('updated');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  const { state: tourState, setProjectList, start: startTour } = useGuidedTour();
  const tourStep = tourState.currentStep?.id;
  const tourRunning = tourState.status === 'running';
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [tourActionProjectId, setTourActionProjectId] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const demoCreationRef = useRef(false);

  const loadProjects = useCallback(async () => {
    // Prevent concurrent executions
    if (loadingRef.current) {
      return;
    }
    
    loadingRef.current = true;
    setLoading(true);
    
    try {
      await vfs.init();
      const projectList = await vfs.listProjects();
      const sorted = projectList.sort((a, b) => 
        b.updatedAt.getTime() - a.updatedAt.getTime()
      );
      setProjects(sorted);
      setProjectList(sorted);
      
    } catch (error) {
      logger.error('Failed to load projects:', error);
      toast.error('Failed to load projects');
      
    } finally {
      setLoading(false);
      setInitialLoadComplete(true);
      loadingRef.current = false;
    }
  }, [setProjectList]);

  // Separate function for reloading projects without demo creation logic
  const reloadProjects = useCallback(async () => {
    try {
      await vfs.init();
      const projectList = await vfs.listProjects();
      const sorted = projectList.sort((a, b) => 
        b.updatedAt.getTime() - a.updatedAt.getTime()
      );
      setProjects(sorted);
      setProjectList(sorted);
    } catch (error) {
      logger.error('Failed to reload projects:', error);
      toast.error('Failed to reload projects');
    }
  }, [setProjectList]);

  const createDemoProject = async () => {
    if (demoCreationRef.current) {
      return; // Prevent multiple demo creations
    }
    
    demoCreationRef.current = true;
    
    try {
      const demoProject = await vfs.createProject(
        'Multi-File Demo',
        'Interactive examples showing how HTML, CSS, and JavaScript files work together'
      );
      await createDemoProjectWithAssets(vfs, demoProject.id);
      toast.success('Demo project created successfully');
      await reloadProjects();
      onProjectSelect(demoProject);
      return demoProject;
    } catch (error) {
      logger.error('Failed to create demo project:', error);
      toast.error('Failed to create demo project');
      demoCreationRef.current = false; // Reset on failure
      throw error;
    }
  };

  const handleStartTour = async () => {
    try {
      // Check if we have any projects, if not create a demo project first
      if (projects.length === 0) {
        await createDemoProject();
      }
      startTour();
    } catch (error) {
      logger.error('Failed to prepare for tour:', error);
      toast.error('Failed to start tour - could not create demo project');
    }
  };

  // Initial load only - no dependency on loadProjects to prevent re-runs
  useEffect(() => {
    if (!initialLoadComplete) {
      loadProjects();
    }
  }, []);

  useEffect(() => {
    if (tourRunning && tourStep !== 'create-project') {
      if (createDialogOpen) {
        setCreateDialogOpen(false);
      }
    }
  }, [tourRunning, tourStep, createDialogOpen]);

  useEffect(() => {
    if (tourRunning && tourStep === 'project-controls' && projects.length > 0) {
      setTourActionProjectId(projects[0].id);
    } else {
      setTourActionProjectId(null);
    }
  }, [tourRunning, tourStep, projects]);

  // Handle automatic tour start for first-time users with no projects
  useEffect(() => {
    if (initialLoadComplete && projects.length === 0 && !tourRunning && !configManager.hasSeenTour()) {
      // First-time user with no projects - create demo before starting tour
      handleStartTour();
    }
  }, [initialLoadComplete, projects.length, tourRunning]);

  const createProject = async () => {
    if (!newProjectName.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    if (newProjectName.length > 50) {
      toast.error('Project name must be 50 characters or less');
      return;
    }

    if (newProjectDescription.length > 200) {
      toast.error('Description must be 200 characters or less');
      return;
    }

    try {
      const project = await vfs.createProject(
        newProjectName.trim().slice(0, 50),
        newProjectDescription.trim().slice(0, 200) || undefined
      );

      if (newProjectTemplate === 'demo') {
        await createDemoProjectWithAssets(vfs, project.id);
      } else {
        await createProjectFromTemplate(vfs, project.id, BAREBONES_PROJECT_TEMPLATE);
      }

      toast.success('Project created successfully');
      setCreateDialogOpen(false);
      setNewProjectName('');
      setNewProjectDescription('');
      setNewProjectTemplate('blank');
      await reloadProjects();
      onProjectSelect(project);
    } catch (error) {
      logger.error('Failed to create project:', error);
      toast.error('Failed to create project');
    }
  };

  const deleteProject = async (project: Project) => {
    if (!confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await vfs.deleteProject(project.id);
      toast.success('Project deleted');
      await reloadProjects();
    } catch (error) {
      logger.error('Failed to delete project:', error);
      toast.error('Failed to delete project');
    }
  };

  const duplicateProject = async (project: Project) => {
    try {
      const newProject = await vfs.duplicateProject(project.id);
      toast.success('Project duplicated successfully');
      await reloadProjects();
      onProjectSelect(newProject);
    } catch (error) {
      logger.error('Failed to duplicate project:', error);
      toast.error('Failed to duplicate project');
    }
  };

  const exportProject = async (project: Project) => {
    try {
      const data = await vfs.exportProject(project.id);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '-')}-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Project exported');
    } catch (error) {
      logger.error('Failed to export project:', error);
      toast.error('Failed to export project');
    }
  };

  const exportProjectAsZip = async (project: Project) => {
    try {
      const blob = await vfs.exportProjectAsZip(project.id);
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Project exported as ZIP');
    } catch (error) {
      logger.error('Failed to export project as ZIP:', error);
      toast.error('Failed to export project as ZIP');
    }
  };

  const importProject = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (!data.project || !data.files) {
          throw new Error('Invalid project file');
        }
        
        const imported = await vfs.importProject(data);
        toast.success('Project imported successfully');
        await reloadProjects();
        onProjectSelect(imported);
      } catch (error) {
        logger.error('Failed to import project:', error);
        toast.error('Failed to import project');
      }
    };
    
    input.click();
  };

  const sortProjects = (projects: Project[], sortBy: SortOption): Project[] => {
    const sorted = [...projects];
    switch (sortBy) {
      case 'updated':
        return sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      case 'created':
        return sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case 'size':
        // Note: This would require loading stats for all projects
        // For now, fallback to updated date
        return sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      default:
        return sorted;
    }
  };

  const filteredProjects = sortProjects(
    projects.filter(project =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    sortBy
  );

  if (loading && !initialLoadComplete) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4">Loading projects...</p>
        </div>
      </div>
    );
  }

  const headerActions: HeaderAction[] = [
    {
      id: 'new-project',
      label: 'New Project',
      icon: Plus,
      onClick: () => setCreateDialogOpen(true),
      content: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCreateDialogOpen(true)}
          data-tour-id="new-project-button"
          className="justify-start"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      ),
    },
    {
      id: 'import',
      label: 'Import',
      icon: Upload,
      onClick: importProject,
      variant: 'outline',
    },
  ];
  
  // Desktop-only settings button
  const desktopSettingsButton = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="end">
        <SettingsPanel />
      </PopoverContent>
    </Popover>
  );

  const mobileMenuContent = (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full justify-start"
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[calc(100vw-2rem)]" align="start">
          <SettingsPanel />
        </PopoverContent>
      </Popover>
      
      {/* Divider */}
      <div className="border-t my-2" />
      
      {/* Footer buttons moved to mobile menu */}
      <Button 
        variant="outline" 
        size="sm"
        onClick={handleStartTour}
        disabled={tourRunning}
        className="w-full justify-start"
        data-tour-id="footer-guided-tour"
      >
        <Info className="mr-2 h-4 w-4" />
        Guided Tour
      </Button>
      
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => router.push('/test-generation')}
        className="w-full justify-start"
      >
        <TestTube className="mr-2 h-4 w-4" />
        Model Tester
      </Button>
      
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => setAboutModalOpen(true)}
        className="w-full justify-start"
      >
        <Info className="mr-2 h-4 w-4" />
        About DeepStudio
      </Button>
      
      <Button 
        variant="outline" 
        size="sm"
        asChild
        className="w-full justify-start"
      >
        <a
          href="https://github.com/o-stahl/deepstudio"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Github className="mr-2 h-4 w-4" />
          GitHub
        </a>
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col h-[100dvh]" style={{ background: `linear-gradient(var(--project-background-tint), var(--project-background-tint)), var(--background)` }}>
      {/* Header */}
      <AppHeader
        onLogoClick={() => setAboutModalOpen(true)}
        actions={headerActions}
        mobileMenuContent={mobileMenuContent}
        desktopOnlyContent={desktopSettingsButton}
        leftText="DeepStudio"
      />
      
      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-auto">
        <div className="container mx-auto p-6 max-w-6xl">

      <div className="mb-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-4" data-tour-id="projects-actions">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-card"
            />
          </div>
          
          <div className="flex gap-2">
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
              <SelectTrigger className="flex-1 md:w-[180px] bg-card">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Last Updated</SelectItem>
                <SelectItem value="created">Date Created</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-0.5 border rounded-sm p-1 bg-card h-9">
              <Button
                size="icon"
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                className="h-full w-8 rounded-sm"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                className="h-full w-8 rounded-sm"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="text-center py-12">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {searchQuery ? 'No projects found' : 'No projects yet'}
          </h2>
          <p className="text-muted-foreground mb-6">
            {searchQuery 
              ? 'Try a different search term' 
              : 'Create your first project to get started'}
          </p>
          {!searchQuery && (
            <div className="flex gap-3 justify-center">
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </Button>
              <Button variant="outline" onClick={createDemoProject}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Create Demo Project
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div
          className={viewMode === 'grid' ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-3' : 'space-y-3'}
          data-tour-id="projects-list"
        >
          {filteredProjects.map(project => {
            if (typeof project !== 'object' || !project.id || !project.name) {
              logger.error('Invalid project object:', project);
              return null;
            }
            
            return (
              <ProjectCard
                key={project.id}
                project={project}
                onSelect={onProjectSelect}
                onDelete={deleteProject}
                onExport={exportProject}
                onExportZip={exportProjectAsZip}
                onDuplicate={duplicateProject}
                onPreview={setPreviewProject}
                onUpdate={(updatedProject) => {
                  setProjects(projects.map(p => 
                    p.id === updatedProject.id ? updatedProject : p
                  ));
                }}
                viewMode={viewMode}
                forceMenuOpen={tourActionProjectId === project.id}
                highlightExport={tourRunning && tourStep === 'project-controls' && tourActionProjectId === project.id}
              />
            );
          })}
        </div>
      )}
        </div>
      </main>

      {/* Footer with Navigation Buttons - Hidden on mobile */}
      <footer className="hidden md:block border-t bg-card/50 py-3 px-6">
        <div className="flex justify-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleStartTour}
            disabled={tourRunning}
            data-tour-id="footer-guided-tour"
          >
            <Info className="mr-2 h-4 w-4" />
            Guided Tour
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => router.push('/test-generation')}
          >
            <TestTube className="mr-2 h-4 w-4" />
            Model Tester
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setAboutModalOpen(true)}
          >
            <Info className="mr-2 h-4 w-4" />
            About DeepStudio
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            asChild
          >
            <a
              href="https://github.com/o-stahl/deepstudio"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="mr-2 h-4 w-4" />
              GitHub
            </a>
          </Button>
        </div>
      </footer>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Start a new multipage website project
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center">
                <Label htmlFor="name">Project Name</Label>
                <span className="text-xs text-muted-foreground">
                  {newProjectName.length}/50
                </span>
              </div>
              <Input
                id="name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value.slice(0, 50))}
                placeholder="My Awesome Website"
                className="mt-2"
                maxLength={50}
              />
            </div>
            <div>
              <Label htmlFor="template">Template</Label>
              <Select
                value={newProjectTemplate}
                onValueChange={(value) => setNewProjectTemplate(value as 'blank' | 'demo')}
              >
                <SelectTrigger id="template" className="mt-2">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Blank (HTML/CSS/JS starter)</SelectItem>
                  <SelectItem value="demo">Demo (multi-page example)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex justify-between items-center">
                <Label htmlFor="description">Description (optional)</Label>
                <span className="text-xs text-muted-foreground">
                  {newProjectDescription.length}/200
                </span>
              </div>
              <Textarea
                id="description"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value.slice(0, 200))}
                placeholder="A brief description of your project"
                className="mt-2 resize-none"
                rows={3}
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createProject}>
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      {previewProject && (
        <Dialog open={!!previewProject} onOpenChange={() => setPreviewProject(null)}>
          <DialogContent className="max-w-[90vw] sm:max-w-[85vw] lg:max-w-[80vw] 2xl:max-w-[1400px] max-h-[90vh] w-full h-full p-0 flex flex-col">
            <DialogHeader className="p-4 border-b">
              <DialogTitle>Preview: {previewProject.name}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-hidden">
              <MultipagePreview
                projectId={previewProject.id}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* About Modal */}
      <AboutModal 
        open={aboutModalOpen} 
        onOpenChange={setAboutModalOpen} 
      />
      <GuidedTourOverlay location="project-manager" />
    </div>
  );
}
