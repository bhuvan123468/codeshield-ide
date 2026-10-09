/********************************************************************************
 * Copyright (C) 2020 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { codicon } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { environment } from '@theia/core/lib/common';
import * as React from 'react';

export interface ExternalBrowserLinkProps {
    text: string;
    url: string;
    windowService: WindowService;
}

export function renderProductName(): React.ReactNode {
    return <h1>CodeShield <span className="tide-branding-accent">IDE</span></h1>;
}

export const PROJECT_URL = 'https://github.com/bhuvan123468/codeshield-ide';

function BrowserLink(props: ExternalBrowserLinkProps): React.JSX.Element {
    return <a
        role={'button'}
        tabIndex={0}
        href={props.url}
        target='_blank'
    >
        {props.text}
    </a>;
}

/*
 * The sections below are shared by the welcome page and the About dialog, so that both describe the product
 * in the same words. Keep them to a sentence or two each: the welcome page has to stay scannable.
 */

export function renderWhatIs(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            <i className={codicon('info')}></i>
            What is this?
        </h3>
        <div>
            CodeShield IDE: AI-assisted secure Java development
        </div>
        <div>
            Open a Java file and use the CodeShield Dashboard to scan for vulnerabilities, preview AI-assisted fixes, and review validation results.
            Built on the <BrowserLink text="Eclipse Theia platform" url="https://theia-ide.org" windowService={windowService} />.
        </div>
    </div>;
}

export function renderExtendingCustomizing(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            <i className={codicon('extensions')}></i>
            Extending &amp; Customizing
        </h3>
        <div>
            You can extend the IDE at runtime by installing VS Code extensions from
            the <BrowserLink text="Open VSX registry" url="https://open-vsx.org/" windowService={windowService} />, an open marketplace. Open the Extensions
            view to browse them.
        </div>
        <div>
            The IDE is built on the flexible Theia platform, so it can also serve as
            a <span className='gs-text-bold'>template</span> for your own tools and IDEs. See
            the <BrowserLink text="documentation" url="https://theia-ide.org/docs/composing_applications/" windowService={windowService} /> to get started.
        </div>
    </div>;
}

export function renderCollaboration(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            <i className={codicon('live-share')}></i>
            Collaboration
        </h3>
        <div>
            Share your workspace with others and work together in real time by clicking <i>Collaborate</i> in the status bar. The feature is powered
            by <BrowserLink text="Open Collaboration Tools" url="https://www.open-collab.tools/" windowService={windowService} /> and uses their public
            server infrastructure.
        </div>
    </div>;
}

export function renderSupport(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            <i className={codicon('organization')}></i>
            Professional Support
        </h3>
        <div>
            Professional support for the underlying Eclipse Theia platform is available
            from selected companies. They are listed on
            the <BrowserLink text="Theia support page" url="https://theia-ide.org/support/" windowService={windowService} />.
        </div>
    </div>;
}

export function renderCommunity(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            <i className={codicon('comment-discussion')}></i>
            Community
        </h3>
        <div>
            Report CodeShield issues to the <BrowserLink text="CodeShield IDE project" url={PROJECT_URL + '/issues/new'}
                windowService={windowService} />. For issues in the underlying platform, see the <BrowserLink text="Eclipse Theia project"
                url="https://github.com/eclipse-theia/theia/issues/new/choose" windowService={windowService} />.
        </div>
        <div>
            The <BrowserLink text="CodeShield IDE source code" url={PROJECT_URL} windowService={windowService} /> is available on GitHub.
            Eclipse copyright and license notices remain included.
        </div>
    </div>;
}

export interface BrandingProps {
    windowService: WindowService;
}

/**
 * Explain the desktop update policy. The inherited updater is excluded from CodeShield builds.
 */
export function renderUpdates(props: BrandingProps): React.ReactNode {
    if (!environment.electron.is()) {
        return undefined;
    }
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            <i className={codicon('cloud-download')}></i>
            Updates
        </h3>
        <div>
            Automatic updates are disabled until a CodeShield release feed is configured. See the
            <BrowserLink text="CodeShield IDE project" url={PROJECT_URL} windowService={props.windowService} /> for project information.
        </div>
    </div>;
}

/**
 * The product description as shown by both the welcome page and the About dialog. Sharing the whole list
 * rather than only the individual sections keeps the two from drifting apart as sections come and go.
 */
export function renderBrandingSections(props: BrandingProps): React.ReactNode {
    const row = (content: React.ReactNode) => <div className='flex-grid'><div className='col'>{content}</div></div>;
    const updates = renderUpdates(props);
    return <React.Fragment>
        {row(renderWhatIs(props.windowService))}
        {row(renderExtendingCustomizing(props.windowService))}
        {row(renderCollaboration(props.windowService))}
        {row(renderSupport(props.windowService))}
        {row(renderCommunity(props.windowService))}
        {updates && row(updates)}
    </React.Fragment>;
}
