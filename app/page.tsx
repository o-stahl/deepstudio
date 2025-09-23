'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Project } from '@/lib/vfs/types';
import { ProjectManager } from '@/components/project-manager';
import { Workspace } from '@/components/workspace';
import { GuidedTourProvider, useGuidedTour } from '@/components/guided-tour/context';
import { GuidedTourOverlay } from '@/components/guided-tour/overlay';

function HomeInner() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const { state, setActiveProjectId } = useGuidedTour();

  const stepId = state.currentStep?.id;
  const isTourRunning = state.status === 'running';

  useEffect(() => {
    if (selectedProject) {
      setActiveProjectId(selectedProject.id);
    } else {
      setActiveProjectId(null);
    }
  }, [selectedProject, setActiveProjectId]);

  useEffect(() => {
    if (!isTourRunning) {
      return;
    }
    if (!stepId) {
      return;
    }

    if (
      stepId === 'welcome' ||
      stepId === 'projects-overview' ||
      stepId === 'create-project' ||
      stepId === 'project-controls' ||
      stepId === 'edit-project'
    ) {
      if (selectedProject) {
        setSelectedProject(null);
      }
      return;
    }

    if (
      stepId === 'workspace-overview' ||
      stepId === 'workspace-edit' ||
      stepId === 'workspace-checkpoint' ||
      stepId === 'provider-settings' ||
      stepId === 'wrap-up'
    ) {
      if (!selectedProject && state.projectList.length > 0) {
        setSelectedProject(state.projectList[0]);
      }
    }
  }, [isTourRunning, stepId, selectedProject, state.projectList]);

  const content = useMemo(() => {
    if (selectedProject) {
      return (
        <Workspace
          project={selectedProject}
          onBack={() => setSelectedProject(null)}
        />
      );
    }
    return (
      <ProjectManager
        onProjectSelect={setSelectedProject}
      />
    );
  }, [selectedProject]);

  return (
    <>
      {content}
      <GuidedTourOverlay location="global" />
    </>
  );
}

export default function Home() {
  return (
    <GuidedTourProvider>
      <HomeInner />
    </GuidedTourProvider>
  );
}
